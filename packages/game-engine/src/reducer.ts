import type { AuctionType, CardDefinition } from '@sotheby/contracts';

import {
  beginOffers,
  initialFixedPriceDeadline,
  respondFixedPrice,
  setFixedPrice,
} from './auctions/fixed-price.ts';
import { isValidJointCard } from './auctions/joint.ts';
import { expireOpenAuction, OPEN_AUCTION_SECONDS, placeOpenBid } from './auctions/open.ts';
import { settleStandardPurchase } from './auctions/payment.ts';
import { resolveSealedBid, submitSealedBid } from './auctions/sealed-bid.ts';
import { actSequential, initialSequentialDeadline } from './auctions/sequential.ts';
import type {
  CommandError,
  CommandResult,
  Deadline,
  EngineEvent,
  GameCommandInput,
} from './commands.ts';
import type {
  ActiveAuctionState,
  AuctionSettlementContext,
  FixedPriceAuctionState,
  GameState,
  JointAuctionState,
  PlayerState,
} from './model.ts';
import { advanceAfterSettlement, settleRound } from './rounds/settlement.ts';
import { checkRoundEnd } from './rounds/end-condition.ts';
import { nextEligibleBuyerAfter, nextSeatPlayerId } from './turns.ts';

const SEALED_BID_SECONDS = 30;
const JOINT_INVITE_SECONDS = 30;

function reject(state: GameState, code: CommandError['code'], message: string): CommandResult {
  return { ok: false, state, error: { code, message }, events: [], scheduledDeadlines: [] };
}

function event(
  state: GameState,
  actorPlayerId: string | null,
  type: string,
  payload: unknown,
  now: Date,
): EngineEvent {
  const sequence = state.eventSequence + 1;
  return {
    eventId: `${state.gameId}:${sequence}`,
    sequence,
    gameId: state.gameId,
    roomId: state.roomId,
    actorPlayerId,
    occurredAt: now.toISOString(),
    rulesVersion: state.rulesVersion,
    type,
    payload,
  };
}

function accept(
  previous: GameState,
  state: GameState,
  actorPlayerId: string | null,
  type: string,
  payload: unknown,
  now: Date,
  deadlines: readonly Deadline[] = [],
): CommandResult {
  const emitted = event(previous, actorPlayerId, type, payload, now);
  return {
    ok: true,
    state: {
      ...state,
      stateVersion: previous.stateVersion + 1,
      eventSequence: emitted.sequence,
    },
    events: [emitted],
    scheduledDeadlines: deadlines.map((item) => ({
      ...item,
      expectedStateVersion: previous.stateVersion + 1,
    })),
  };
}

function deadline(
  state: GameState,
  category: string,
  expiresAt: string,
): Deadline {
  return {
    id: `${state.gameId}:${category}:${state.stateVersion + 1}`,
    roomId: state.roomId,
    gameId: state.gameId,
    expectedStateVersion: state.stateVersion + 1,
    expiresAt,
    action: 'EXPIRE_AUCTION',
  };
}

function startAuction(
  state: GameState,
  cards: readonly CardDefinition[],
  auctionType: Exclude<AuctionType, 'JOINT'>,
  settlement: AuctionSettlementContext,
  now: Date,
): { state: GameState; deadlines: readonly Deadline[] } {
  switch (auctionType) {
    case 'OPEN': {
      const expiresAt = new Date(now.getTime() + OPEN_AUCTION_SECONDS * 1000).toISOString();
      return {
        state: {
          ...state,
          auction: { type: 'OPEN', cards, settlement, currentPrice: 0, expiresAt },
        },
        deadlines: [deadline(state, 'open', expiresAt)],
      };
    }
    case 'FIXED_PRICE': {
      const expiresAt = new Date(now.getTime() + 60_000).toISOString();
      const auction: FixedPriceAuctionState = {
        type: 'FIXED_PRICE',
        cards,
        settlement,
        phase: 'PRICING',
        actingPlayerId: state.hostPlayerId,
        expiresAt,
      };
      return { state: { ...state, auction }, deadlines: [initialFixedPriceDeadline(state, now)] };
    }
    case 'SEQUENTIAL': {
      const actingPlayerId =
        nextEligibleBuyerAfter(state, state.hostPlayerId, null) ?? state.hostPlayerId;
      const expiresAt = new Date(now.getTime() + 30_000).toISOString();
      return {
        state: {
          ...state,
          auction: {
            type: 'SEQUENTIAL',
            cards,
            settlement,
            currentPrice: 0,
            actingPlayerId,
            actedPlayerIds: [],
            expiresAt,
          },
        },
        deadlines: [initialSequentialDeadline(state, expiresAt)],
      };
    }
    case 'SEALED_BID': {
      const expiresAt = new Date(now.getTime() + SEALED_BID_SECONDS * 1000).toISOString();
      return {
        state: {
          ...state,
          auction: {
            type: 'SEALED_BID',
            cards,
            settlement,
            stolen: cards.some((card) => card.stolen),
            bids: {},
            expiresAt,
            revealed: false,
          },
        },
        deadlines: [deadline(state, 'sealed', expiresAt)],
      };
    }
  }
}

function removeCard(player: PlayerState, cardId: string): PlayerState {
  return { ...player, hand: player.hand.filter((card) => card.id !== cardId) };
}

function enterRoundSettlement(state: GameState, hostPlayerId: string): GameState {
  return settleRound({
    ...state,
    status: 'ROUND_SETTLEMENT',
    auction: null,
    hostPlayerId,
    roundEndHostPlayerId: hostPlayerId,
  }).state;
}

function finalizeAuctionState(state: GameState): GameState {
  return state.status === 'ROUND_SETTLEMENT'
    ? settleRound(state).state
    : state;
}

function playCard(
  state: GameState,
  command: Extract<GameCommandInput, { type: 'PLAY_CARD' }>,
  now: Date,
): CommandResult {
  if (command.playerId !== state.hostPlayerId) {
    return reject(state, 'NOT_HOST', 'Only the host can play a card');
  }
  if (state.auction !== null) return reject(state, 'AUCTION_ACTIVE', 'An auction is already active');
  const host = state.players[command.playerId];
  if (host === undefined) return reject(state, 'PLAYER_NOT_FOUND', 'Host is not seated');
  const card = host.hand.find((candidate) => candidate.id === command.payload.cardId);
  if (card === undefined) return reject(state, 'CARD_NOT_FOUND', 'Card is not in the host hand');

  const players: Record<string, PlayerState> = {
    ...state.players,
    [host.id]: removeCard(host, card.id),
  };
  const withoutCard = { ...state, players };
  const endDecision = checkRoundEnd(state, [card]);
  if (endDecision.ended) {
    return accept(
      state,
      enterRoundSettlement(
        { ...withoutCard, discardedCards: [...state.discardedCards, card] },
        host.id,
      ),
      command.playerId,
      'ROUND_ENDED',
      endDecision,
      now,
    );
  }

  if (card.auctionType === 'JOINT') {
    const auction: JointAuctionState = {
      type: 'JOINT',
      cards: [card],
      oldHostId: host.id,
      phase: 'CHOOSING_MODE',
      actingPlayerId: host.id,
      invitedPlayerIds: [],
    };
    return accept(
      state,
      { ...withoutCard, auction },
      command.playerId,
      'CARD_PLAYED',
      { cardId: card.id, auctionType: card.auctionType },
      now,
    );
  }

  const started = startAuction(
    withoutCard,
    [card],
    card.auctionType,
    { kind: 'STANDARD', sellerId: host.id, nextHostBaseId: host.id },
    now,
  );
  return accept(
    state,
    started.state,
    command.playerId,
    'CARD_PLAYED',
    { cardId: card.id, auctionType: card.auctionType },
    now,
    started.deadlines,
  );
}

function requireAuction<T extends ActiveAuctionState['type']>(
  state: GameState,
  type: T,
): Extract<ActiveAuctionState, { type: T }> | CommandError {
  if (state.auction === null) {
    return { code: 'NO_ACTIVE_AUCTION', message: 'There is no active auction' };
  }
  if (state.auction.type !== type) {
    return { code: 'WRONG_AUCTION_TYPE', message: `Expected ${type} auction` };
  }
  return state.auction as Extract<ActiveAuctionState, { type: T }>;
}

function chooseSelfJointCard(
  state: GameState,
  command: Extract<GameCommandInput, { type: 'CHOOSE_SELF_JOINT_CARD' }>,
  now: Date,
): CommandResult {
  const auction = requireAuction(state, 'JOINT');
  if ('code' in auction) return reject(state, auction.code, auction.message);
  if (auction.phase !== 'CHOOSING_MODE' || command.playerId !== auction.oldHostId) {
    return reject(state, 'NOT_YOUR_TURN', 'Only the old host can choose a self-joint card');
  }
  const host = state.players[command.playerId];
  if (!host) return reject(state, 'PLAYER_NOT_FOUND', 'Host is not seated');
  const card = host.hand.find((candidate) => candidate.id === command.payload.cardId);
  if (!card) return reject(state, 'CARD_NOT_FOUND', 'Joint card is not in the host hand');
  const initialCard = auction.cards[0];
  if (!initialCard || !isValidJointCard(initialCard, card)) {
    return reject(state, 'INVALID_JOINT_CARD', 'Joint card must match series and be non-stolen/non-joint');
  }

  const withCardRemoved: GameState = {
    ...state,
    players: { ...state.players, [host.id]: removeCard(host, card.id) },
  };
  const endDecision = checkRoundEnd(state, [initialCard, card]);
  if (endDecision.ended) {
    return accept(
      state,
      enterRoundSettlement(
        { ...withCardRemoved, discardedCards: [...state.discardedCards, initialCard, card] },
        auction.oldHostId,
      ),
      command.playerId,
      'ROUND_ENDED',
      endDecision,
      now,
    );
  }
  const started = startAuction(
    withCardRemoved,
    [initialCard, card],
    card.auctionType,
    { kind: 'JOINT_SELF', oldHostId: auction.oldHostId },
    now,
  );
  return accept(
    state,
    started.state,
    command.playerId,
    'JOINT_SELF_CARD_CHOSEN',
    { cardId: card.id },
    now,
    started.deadlines,
  );
}

function beginJointInvites(
  state: GameState,
  auction: JointAuctionState,
  actorPlayerId: string,
  now: Date,
): CommandResult {
  if (actorPlayerId !== auction.oldHostId || auction.phase !== 'CHOOSING_MODE') {
    return reject(state, 'NOT_YOUR_TURN', 'Only the old host can invite a joint partner');
  }
  const actingPlayerId = nextSeatPlayerId(state, auction.oldHostId);
  const expiresAt = new Date(now.getTime() + JOINT_INVITE_SECONDS * 1000).toISOString();
  const nextAuction: JointAuctionState = {
    ...auction,
    phase: 'INVITING',
    actingPlayerId,
    invitedPlayerIds: [],
    expiresAt,
  };
  return accept(
    state,
    { ...state, auction: nextAuction },
    actorPlayerId,
    'JOINT_INVITES_STARTED',
    {},
    now,
    [deadline(state, 'joint-invite', expiresAt)],
  );
}

function respondJointInvite(
  state: GameState,
  command: Extract<GameCommandInput, { type: 'RESPOND_JOINT_INVITE' }>,
  now: Date,
  timedOut = false,
): CommandResult {
  const auction = requireAuction(state, 'JOINT');
  if ('code' in auction) return reject(state, auction.code, auction.message);
  if (auction.phase !== 'INVITING' || auction.actingPlayerId !== command.playerId) {
    return reject(state, 'NOT_YOUR_TURN', 'It is not this player\'s joint invitation');
  }
  if (!timedOut && auction.expiresAt && now.getTime() >= Date.parse(auction.expiresAt)) {
    return reject(state, 'AUCTION_EXPIRED', 'Joint invitation expired');
  }

  if (command.payload.accept) {
    const player = state.players[command.playerId];
    if (!player) return reject(state, 'PLAYER_NOT_FOUND', 'Player is not seated');
    const card = player.hand.find((candidate) => candidate.id === command.payload.cardId);
    const initialCard = auction.cards[0];
    if (!card) return reject(state, 'CARD_NOT_FOUND', 'Joint card is not in the player hand');
    if (!initialCard || !isValidJointCard(initialCard, card)) {
      return reject(state, 'INVALID_JOINT_CARD', 'Joint card must match series and be non-stolen/non-joint');
    }
    const newHostId = command.playerId;
    const withPartner: GameState = {
      ...state,
      hostPlayerId: newHostId,
      players: { ...state.players, [newHostId]: removeCard(player, card.id) },
    };
    const endDecision = checkRoundEnd(state, [initialCard, card]);
    if (endDecision.ended) {
      return accept(
        state,
        enterRoundSettlement(
          { ...withPartner, discardedCards: [...state.discardedCards, initialCard, card] },
          auction.oldHostId,
        ),
        command.playerId,
        'ROUND_ENDED',
        endDecision,
        now,
      );
    }
    const started = startAuction(
      withPartner,
      [initialCard, card],
      card.auctionType,
      { kind: 'JOINT_PARTNER', oldHostId: auction.oldHostId, newHostId },
      now,
    );
    return accept(
      state,
      started.state,
      command.playerId,
      'JOINT_PARTNER_ACCEPTED',
      { cardId: card.id },
      now,
      started.deadlines,
    );
  }

  const invitedPlayerIds = [...auction.invitedPlayerIds, command.playerId];
  let next = nextSeatPlayerId(state, command.playerId);
  while (next !== auction.oldHostId && invitedPlayerIds.includes(next)) {
    next = nextSeatPlayerId(state, next);
  }
  if (next === auction.oldHostId) {
    const initialCard = auction.cards[0];
    if (!initialCard) return reject(state, 'CARD_NOT_FOUND', 'Joint auction has no initial card');
    const settled = settleStandardPurchase(
      state,
      auction.oldHostId,
      auction.oldHostId,
      0,
      [initialCard],
    );
    return accept(
      state,
      settled.state,
      timedOut ? null : command.playerId,
      'JOINT_AUCTION_UNMATCHED',
      { timedOut },
      now,
    );
  }

  const expiresAt = new Date(now.getTime() + JOINT_INVITE_SECONDS * 1000).toISOString();
  const nextAuction: JointAuctionState = {
    ...auction,
    actingPlayerId: next,
    invitedPlayerIds,
    expiresAt,
  };
  return accept(
    state,
    { ...state, auction: nextAuction },
    timedOut ? null : command.playerId,
    'JOINT_INVITE_DECLINED',
    { timedOut },
    now,
    [deadline(state, 'joint-invite', expiresAt)],
  );
}

function settlementPayload(
  outcome: { transfers: readonly unknown[] },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...extra, transfers: outcome.transfers };
}

export function handleCommand(state: GameState, command: GameCommandInput, now: Date): CommandResult {
  if (command.stateVersion !== state.stateVersion) {
    return reject(state, 'STALE_STATE', 'Command used an old state version');
  }
  if (state.players[command.playerId] === undefined) {
    return reject(state, 'PLAYER_NOT_FOUND', 'Player is not seated');
  }

  if (state.status === 'FINISHED') {
    return reject(state, 'INVALID_GAME_STATUS', 'The game has already finished');
  }
  if (state.status === 'ROUND_SETTLEMENT' && command.type !== 'ADVANCE_AFTER_SETTLEMENT') {
    return reject(state, 'INVALID_GAME_STATUS', 'The round settlement must be advanced first');
  }

  if (command.type === 'ADVANCE_AFTER_SETTLEMENT') {
    if (state.status !== 'ROUND_SETTLEMENT') {
      return reject(state, 'INVALID_GAME_STATUS', 'Game is not awaiting round advancement');
    }
    return accept(state, advanceAfterSettlement(state), command.playerId, 'ROUND_ADVANCED', {}, now);
  }

  if (command.type === 'PLAY_CARD') return playCard(state, command, now);
  if (command.type === 'CHOOSE_SELF_JOINT_CARD') return chooseSelfJointCard(state, command, now);

  if (command.type === 'INVITE_JOINT_PLAYER') {
    const auction = requireAuction(state, 'JOINT');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    return beginJointInvites(state, auction, command.playerId, now);
  }

  if (command.type === 'RESPOND_JOINT_INVITE') {
    return respondJointInvite(state, command, now);
  }

  if (command.type === 'PLACE_OPEN_BID') {
    const auction = requireAuction(state, 'OPEN');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = placeOpenBid(state, auction, command.playerId, command.payload.amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    return accept(
      state,
      { ...state, auction: outcome.auction },
      command.playerId,
      'OPEN_BID_PLACED',
      command.payload,
      now,
      [outcome.deadline],
    );
  }

  if (command.type === 'SET_FIXED_PRICE') {
    const auction = requireAuction(state, 'FIXED_PRICE');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = setFixedPrice(state, auction, command.playerId, command.payload.amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) {
      return accept(
        state,
        finalizeAuctionState(outcome.state),
        command.playerId,
        'AUCTION_SETTLED',
        settlementPayload(outcome, { price: command.payload.amount }),
        now,
      );
    }
    return accept(
      state,
      { ...state, auction: outcome.auction },
      command.playerId,
      'FIXED_PRICE_SET',
      command.payload,
      now,
      outcome.deadline ? [outcome.deadline] : [],
    );
  }

  if (command.type === 'RESPOND_FIXED_PRICE') {
    const auction = requireAuction(state, 'FIXED_PRICE');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = respondFixedPrice(state, auction, command.playerId, command.payload.accept, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) {
      return accept(
        state,
        finalizeAuctionState(outcome.state),
        command.playerId,
        'AUCTION_SETTLED',
        settlementPayload(outcome, { accepted: command.payload.accept }),
        now,
      );
    }
    return accept(
      state,
      { ...state, auction: outcome.auction },
      command.playerId,
      'FIXED_PRICE_DECLINED',
      {},
      now,
      [outcome.deadline],
    );
  }

  if (command.type === 'PLACE_SEQUENTIAL_BID' || command.type === 'PASS_SEQUENTIAL') {
    const auction = requireAuction(state, 'SEQUENTIAL');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const amount = command.type === 'PLACE_SEQUENTIAL_BID' ? command.payload.amount : null;
    const outcome = actSequential(state, auction, command.playerId, amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) {
      return accept(
        state,
        finalizeAuctionState(outcome.state),
        command.playerId,
        'AUCTION_SETTLED',
        settlementPayload(outcome, { amount }),
        now,
      );
    }
    return accept(
      state,
      { ...state, auction: outcome.auction },
      command.playerId,
      amount === null ? 'SEQUENTIAL_PASSED' : 'SEQUENTIAL_BID_PLACED',
      { amount },
      now,
      [outcome.deadline],
    );
  }

  if (command.type === 'SUBMIT_SEALED_BID') {
    const auction = requireAuction(state, 'SEALED_BID');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const nextAuction = submitSealedBid(
      state,
      auction,
      command.playerId,
      command.payload.amount,
      now,
    );
    if ('code' in nextAuction) return reject(state, nextAuction.code, nextAuction.message);
    return accept(
      state,
      { ...state, auction: nextAuction },
      command.playerId,
      'SEALED_BID_SUBMITTED',
      { submitted: true },
      now,
    );
  }

  if (command.type === 'EXPIRE_AUCTION') {
    if (state.auction === null) {
      return reject(state, 'NO_ACTIVE_AUCTION', 'There is no active auction');
    }
    if ('expiresAt' in state.auction && state.auction.expiresAt !== undefined) {
      if (now.getTime() < Date.parse(state.auction.expiresAt)) {
        return reject(state, 'AUCTION_NOT_EXPIRED', 'The auction is still active');
      }
    }

    if (state.auction.type === 'OPEN') {
      const outcome = expireOpenAuction(state, state.auction, now);
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      return accept(state, finalizeAuctionState(outcome.state), command.playerId, 'AUCTION_SETTLED', settlementPayload(outcome), now);
    }
    if (state.auction.type === 'FIXED_PRICE') {
      if (state.auction.phase === 'PRICING') {
        const outcome = beginOffers(state, state.auction, 0, now);
        if ('state' in outcome) {
          return accept(state, finalizeAuctionState(outcome.state), null, 'AUCTION_SETTLED', settlementPayload(outcome, { price: 0 }), now);
        }
        return accept(
          state,
          { ...state, auction: outcome.auction },
          null,
          'FIXED_PRICE_SET',
          { amount: 0, timedOut: true },
          now,
          outcome.deadline ? [outcome.deadline] : [],
        );
      }
      const actor = state.auction.actingPlayerId;
      const outcome = respondFixedPrice(
        state,
        state.auction,
        actor,
        false,
        new Date(Date.parse(state.auction.expiresAt) - 1),
      );
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      if ('state' in outcome) {
        return accept(state, finalizeAuctionState(outcome.state), null, 'AUCTION_SETTLED', settlementPayload(outcome, { timedOut: true }), now);
      }
      return accept(
        state,
        { ...state, auction: outcome.auction },
        null,
        'FIXED_PRICE_DECLINED',
        { timedOut: true },
        now,
        [outcome.deadline],
      );
    }
    if (state.auction.type === 'SEQUENTIAL') {
      const outcome = actSequential(
        state,
        state.auction,
        state.auction.actingPlayerId,
        null,
        new Date(Date.parse(state.auction.expiresAt) - 1),
      );
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      if ('state' in outcome) {
        return accept(state, finalizeAuctionState(outcome.state), null, 'AUCTION_SETTLED', settlementPayload(outcome, { timedOut: true }), now);
      }
      return accept(
        state,
        { ...state, auction: outcome.auction },
        null,
        'SEQUENTIAL_PASSED',
        { timedOut: true },
        now,
        [outcome.deadline],
      );
    }
    if (state.auction.type === 'SEALED_BID') {
      const outcome = resolveSealedBid(state, state.auction);
      return accept(
        state,
        finalizeAuctionState(outcome.state),
        null,
        'AUCTION_SETTLED',
        settlementPayload(outcome, { winnerId: outcome.winnerId, bids: outcome.bids }),
        now,
      );
    }
    if (state.auction.type === 'JOINT' && state.auction.phase === 'INVITING') {
      return respondJointInvite(
        state,
        {
          requestId: command.requestId,
          playerId: state.auction.actingPlayerId,
          stateVersion: command.stateVersion,
          type: 'RESPOND_JOINT_INVITE',
          payload: { accept: false },
        },
        now,
        true,
      );
    }
  }

  return reject(state, 'WRONG_AUCTION_TYPE', 'Unsupported command');
}
