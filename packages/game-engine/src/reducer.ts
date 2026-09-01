import type { CardDefinition } from '@sotheby/contracts';

import { beginOffers, initialFixedPriceDeadline, respondFixedPrice, setFixedPrice } from './auctions/fixed-price.ts';
import { expireOpenAuction, OPEN_AUCTION_SECONDS, placeOpenBid } from './auctions/open.ts';
import { actSequential, initialSequentialDeadline } from './auctions/sequential.ts';
import type { CommandError, CommandResult, Deadline, EngineEvent, GameCommandInput } from './commands.ts';
import type { ActiveAuctionState, FixedPriceAuctionState, GameState, PlayerState } from './model.ts';
import { nextEligibleBuyerAfter } from './turns.ts';

function reject(state: GameState, code: CommandError['code'], message: string): CommandResult {
  return { ok: false, state, error: { code, message }, events: [], scheduledDeadlines: [] };
}

function event(state: GameState, actorPlayerId: string | null, type: string, payload: unknown, now: Date): EngineEvent {
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
    state: { ...state, stateVersion: previous.stateVersion + 1, eventSequence: emitted.sequence },
    events: [emitted],
    scheduledDeadlines: deadlines.map((item) => ({ ...item, expectedStateVersion: previous.stateVersion + 1 })),
  };
}

function startAuction(state: GameState, card: CardDefinition, now: Date): { state: GameState; deadlines: readonly Deadline[] } {
  const cards = [card];
  switch (card.auctionType) {
    case 'OPEN': {
      const expiresAt = new Date(now.getTime() + OPEN_AUCTION_SECONDS * 1000).toISOString();
      return {
        state: { ...state, auction: { type: 'OPEN', cards, currentPrice: 0, expiresAt } },
        deadlines: [{ id: `${state.gameId}:open:${state.stateVersion + 1}`, roomId: state.roomId, gameId: state.gameId, expectedStateVersion: state.stateVersion + 1, expiresAt, action: 'EXPIRE_AUCTION' }],
      };
    }
    case 'FIXED_PRICE': {
      const expiresAt = new Date(now.getTime() + 60_000).toISOString();
      const auction: FixedPriceAuctionState = { type: 'FIXED_PRICE', cards, phase: 'PRICING', actingPlayerId: state.hostPlayerId, expiresAt };
      return { state: { ...state, auction }, deadlines: [initialFixedPriceDeadline(state, now)] };
    }
    case 'SEQUENTIAL': {
      const actingPlayerId = nextEligibleBuyerAfter(state, state.hostPlayerId, null) ?? state.hostPlayerId;
      const expiresAt = new Date(now.getTime() + 30_000).toISOString();
      return {
        state: { ...state, auction: { type: 'SEQUENTIAL', cards, currentPrice: 0, actingPlayerId, actedPlayerIds: [], expiresAt } },
        deadlines: [initialSequentialDeadline(state, expiresAt)],
      };
    }
    default:
      throw new Error(`Auction type ${card.auctionType} is not implemented yet`);
  }
}

function playCard(state: GameState, command: Extract<GameCommandInput, { type: 'PLAY_CARD' }>, now: Date): CommandResult {
  if (command.playerId !== state.hostPlayerId) return reject(state, 'NOT_HOST', 'Only the host can play a card');
  if (state.auction !== null) return reject(state, 'AUCTION_ACTIVE', 'An auction is already active');
  const host = state.players[command.playerId];
  if (host === undefined) return reject(state, 'PLAYER_NOT_FOUND', 'Host is not seated');
  const card = host.hand.find((candidate) => candidate.id === command.payload.cardId);
  if (card === undefined) return reject(state, 'CARD_NOT_FOUND', 'Card is not in the host hand');
  if (card.auctionType === 'JOINT' || card.auctionType === 'SEALED_BID') {
    return reject(state, 'WRONG_AUCTION_TYPE', 'This auction type is not implemented in the standard reducer');
  }
  const players: Record<string, PlayerState> = {
    ...state.players,
    [host.id]: { ...host, hand: host.hand.filter((held) => held.id !== card.id) },
  };
  const started = startAuction({ ...state, players }, card, now);
  return accept(state, started.state, command.playerId, 'CARD_PLAYED', { cardId: card.id, auctionType: card.auctionType }, now, started.deadlines);
}

function requireAuction<T extends ActiveAuctionState['type']>(state: GameState, type: T): Extract<ActiveAuctionState, { type: T }> | CommandError {
  if (state.auction === null) return { code: 'NO_ACTIVE_AUCTION', message: 'There is no active auction' };
  if (state.auction.type !== type) return { code: 'WRONG_AUCTION_TYPE', message: `Expected ${type} auction` };
  return state.auction as Extract<ActiveAuctionState, { type: T }>;
}

export function handleCommand(state: GameState, command: GameCommandInput, now: Date): CommandResult {
  if (command.stateVersion !== state.stateVersion) return reject(state, 'STALE_STATE', 'Command used an old state version');
  if (state.players[command.playerId] === undefined) return reject(state, 'PLAYER_NOT_FOUND', 'Player is not seated');

  if (command.type === 'PLAY_CARD') return playCard(state, command, now);

  if (command.type === 'PLACE_OPEN_BID') {
    const auction = requireAuction(state, 'OPEN');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = placeOpenBid(state, auction, command.playerId, command.payload.amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    return accept(state, { ...state, auction: outcome.auction }, command.playerId, 'OPEN_BID_PLACED', command.payload, now, [outcome.deadline]);
  }

  if (command.type === 'SET_FIXED_PRICE') {
    const auction = requireAuction(state, 'FIXED_PRICE');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = setFixedPrice(state, auction, command.playerId, command.payload.amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) return accept(state, outcome.state, command.playerId, 'AUCTION_SETTLED', { price: command.payload.amount }, now);
    return accept(state, { ...state, auction: outcome.auction }, command.playerId, 'FIXED_PRICE_SET', command.payload, now, outcome.deadline ? [outcome.deadline] : []);
  }

  if (command.type === 'RESPOND_FIXED_PRICE') {
    const auction = requireAuction(state, 'FIXED_PRICE');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const outcome = respondFixedPrice(state, auction, command.playerId, command.payload.accept, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) return accept(state, outcome.state, command.playerId, 'AUCTION_SETTLED', { accepted: command.payload.accept }, now);
    return accept(state, { ...state, auction: outcome.auction }, command.playerId, 'FIXED_PRICE_DECLINED', {}, now, [outcome.deadline]);
  }

  if (command.type === 'PLACE_SEQUENTIAL_BID' || command.type === 'PASS_SEQUENTIAL') {
    const auction = requireAuction(state, 'SEQUENTIAL');
    if ('code' in auction) return reject(state, auction.code, auction.message);
    const amount = command.type === 'PLACE_SEQUENTIAL_BID' ? command.payload.amount : null;
    const outcome = actSequential(state, auction, command.playerId, amount, now);
    if ('code' in outcome) return reject(state, outcome.code, outcome.message);
    if ('state' in outcome) return accept(state, outcome.state, command.playerId, 'AUCTION_SETTLED', { amount }, now);
    return accept(state, { ...state, auction: outcome.auction }, command.playerId, amount === null ? 'SEQUENTIAL_PASSED' : 'SEQUENTIAL_BID_PLACED', { amount }, now, [outcome.deadline]);
  }

  if (command.type === 'EXPIRE_AUCTION') {
    if (state.auction === null) return reject(state, 'NO_ACTIVE_AUCTION', 'There is no active auction');
    if (state.auction.type === 'OPEN') {
      const outcome = expireOpenAuction(state, state.auction, now);
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      return accept(state, outcome.state, command.playerId, 'AUCTION_SETTLED', {}, now);
    }
    if (state.auction.type === 'FIXED_PRICE') {
      if (now.getTime() < Date.parse(state.auction.expiresAt)) return reject(state, 'AUCTION_NOT_EXPIRED', 'The auction is still active');
      if (state.auction.phase === 'PRICING') {
        const outcome = beginOffers(state, state.auction, 0, now);
        if ('state' in outcome) return accept(state, outcome.state, null, 'AUCTION_SETTLED', { price: 0 }, now);
        return accept(state, { ...state, auction: outcome.auction }, null, 'FIXED_PRICE_SET', { amount: 0, timedOut: true }, now, outcome.deadline ? [outcome.deadline] : []);
      }
      const actor = state.auction.actingPlayerId;
      if (actor === undefined) return reject(state, 'NOT_YOUR_TURN', 'No player is waiting to respond');
      const outcome = respondFixedPrice(state, state.auction, actor, false, new Date(Date.parse(state.auction.expiresAt) - 1));
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      if ('state' in outcome) return accept(state, outcome.state, null, 'AUCTION_SETTLED', { timedOut: true }, now);
      return accept(state, { ...state, auction: outcome.auction }, null, 'FIXED_PRICE_DECLINED', { timedOut: true }, now, [outcome.deadline]);
    }
    if (state.auction.type === 'SEQUENTIAL') {
      if (now.getTime() < Date.parse(state.auction.expiresAt)) return reject(state, 'AUCTION_NOT_EXPIRED', 'The auction is still active');
      const outcome = actSequential(state, state.auction, state.auction.actingPlayerId, null, new Date(Date.parse(state.auction.expiresAt) - 1));
      if ('code' in outcome) return reject(state, outcome.code, outcome.message);
      if ('state' in outcome) return accept(state, outcome.state, null, 'AUCTION_SETTLED', { timedOut: true }, now);
      return accept(state, { ...state, auction: outcome.auction }, null, 'SEQUENTIAL_PASSED', { timedOut: true }, now, [outcome.deadline]);
    }
    return reject(state, 'WRONG_AUCTION_TYPE', 'This auction timeout is not implemented yet');
  }

  return reject(state, 'WRONG_AUCTION_TYPE', 'Unsupported command');
}
