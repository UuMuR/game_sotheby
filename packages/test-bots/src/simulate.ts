import type { AuctionType } from '@sotheby/contracts';
import {
  advanceAfterSettlement,
  handleCommand,
  initializeGame,
  loadPlaceholderCatalog,
  projectForPlayer,
  rankPlayers,
  settleRound,
  type CommandResult,
  type GameCommandInput,
  type GameState,
} from '@sotheby/game-engine';

import { createBotCommandFactory } from './bot.ts';
import { affordableBid, chooseHostCard, findJointCompanion } from './strategy.ts';

export interface SimulationOptions {
  playerCount: 3 | 4 | 6 | 8;
  seed: number;
}

export interface SimulationCoverage {
  auctionTypes: readonly AuctionType[];
  stolenSealedBid: boolean;
  jointPartnerAuction: boolean;
  timeout: boolean;
  negativeBalance: boolean;
}

export interface SimulationResult {
  state: GameState;
  standings: ReturnType<typeof rankPlayers>;
  eventSequences: readonly number[];
  stateVersions: readonly number[];
  uniqueCardLocations: boolean;
  privateViewsSafe: boolean;
  coverage: SimulationCoverage;
}

function deterministicRandom(seed: number) {
  let value = seed >>> 0;
  return {
    next(): number {
      value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
      return value / 4_294_967_296;
    },
    integer(maxExclusive: number): number {
      if (maxExclusive <= 0) throw new Error('maxExclusive must be positive');
      return Math.floor(this.next() * maxExclusive);
    },
    shuffle<T>(items: readonly T[]): T[] {
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const other = Math.floor(this.next() * (index + 1));
        [result[index], result[other]] = [result[other]!, result[index]!];
      }
      return result;
    },
  };
}

function cardIdsInState(state: GameState): string[] {
  return [
    ...state.deck.map((card) => card.id),
    ...state.discardedCards.map((card) => card.id),
    ...Object.values(state.players).flatMap((player) => [
      ...player.hand.map((card) => card.id),
      ...player.purchasedCards.map((card) => card.id),
    ]),
    ...(state.auction?.cards.map((card) => card.id) ?? []),
  ];
}

function hasUniqueCardLocations(state: GameState): boolean {
  const ids = cardIdsInState(state);
  return ids.length === 84 && new Set(ids).size === 84;
}

function privateViewsAreSafe(state: GameState): boolean {
  return state.seatOrder.every((viewerId) => {
    const view = projectForPlayer(state, viewerId);
    return state.seatOrder.every((otherId) => {
      if (otherId === viewerId) return true;
      const other = state.players[otherId];
      if (!other) return false;
      const serialized = JSON.stringify(view.players.find((player) => player.id === otherId));
      return !serialized.includes('"cash"') && !other.hand.some((card) => serialized.includes(card.id));
    });
  });
}

function pickEligiblePlayer(state: GameState, exclude: ReadonlySet<string> = new Set()): string | null {
  return state.seatOrder.find((id) => !exclude.has(id) && (state.players[id]?.cash ?? 0) > 0) ?? null;
}

export function simulateGame(options: SimulationOptions): SimulationResult {
  const randomSource = deterministicRandom(options.seed);
  const factory = createBotCommandFactory();
  let nowMs = Date.parse('2026-09-01T00:00:00.000Z');
  let state = initializeGame({
    roomId: `room-${options.seed}`,
    gameId: `game-${options.seed}`,
    players: Array.from({ length: options.playerCount }, (_, index) => ({
      id: `p${index + 1}`,
      nickname: `玩家${index + 1}`,
      avatarUrl: `/avatars/${index + 1}.png`,
    })),
    catalog: loadPlaceholderCatalog(),
    randomSource,
  });

  const eventSequences: number[] = [];
  const stateVersions: number[] = [state.stateVersion];
  const coveredTypes = new Set<AuctionType>();
  let stolenSealedBid = false;
  let jointPartnerAuction = false;
  let timeout = false;
  let negativeBalance = false;
  let uniqueCardLocations = hasUniqueCardLocations(state);
  let privateViewsSafe = privateViewsAreSafe(state);
  let steps = 0;

  const apply = (command: GameCommandInput, atMs = nowMs): CommandResult => {
    const result = handleCommand(state, command, new Date(atMs));
    if (!result.ok) throw new Error(`${command.type} rejected: ${result.error.code}`);
    state = result.state;
    eventSequences.push(...result.events.map((item) => item.sequence));
    stateVersions.push(state.stateVersion);
    uniqueCardLocations &&= hasUniqueCardLocations(state);
    privateViewsSafe &&= privateViewsAreSafe(state);
    negativeBalance ||= Object.values(state.players).some((player) => player.cash < 0);
    nowMs = atMs + 1000;
    return result;
  };

  while (state.status !== 'FINISHED') {
    steps += 1;
    if (steps > 5_000) throw new Error('Simulation exceeded 5000 steps');

    if (state.status === 'ROUND_SETTLEMENT') {
      state = settleRound(state).state;
      negativeBalance ||= Object.values(state.players).some((player) => player.cash < 0);
      state = advanceAfterSettlement(state);
      uniqueCardLocations &&= hasUniqueCardLocations(state);
      privateViewsSafe &&= privateViewsAreSafe(state);
      continue;
    }

    if (state.auction === null) {
      const host = state.players[state.hostPlayerId];
      if (!host || host.hand.length === 0) {
        const allEmpty = Object.values(state.players).every((player) => player.hand.length === 0);
        if (!allEmpty) {
          state = { ...state, hostPlayerId: state.seatOrder[(host?.seat ?? 0) + 1] ?? state.seatOrder[0]! };
          continue;
        }
        state = { ...state, status: 'ROUND_SETTLEMENT', roundEndHostPlayerId: state.hostPlayerId };
        continue;
      }
      const selected = chooseHostCard(state, coveredTypes);
      coveredTypes.add(selected.auctionType);
      stolenSealedBid ||= selected.stolen;
      apply(factory.create(state, state.hostPlayerId, 'PLAY_CARD', { cardId: selected.id }));
      continue;
    }

    const auction = state.auction;
    if (auction.type === 'OPEN') {
      const bidder = pickEligiblePlayer(state);
      if (bidder !== null && auction.currentBidderId === undefined) {
        apply(factory.create(state, bidder, 'PLACE_OPEN_BID', { amount: 1 }));
      } else {
        timeout = true;
        apply(factory.create(state, state.hostPlayerId, 'EXPIRE_AUCTION', {}), Date.parse(auction.expiresAt));
      }
      continue;
    }

    if (auction.type === 'FIXED_PRICE') {
      if (auction.phase === 'PRICING') {
        const hostCash = state.players[state.hostPlayerId]?.cash ?? 0;
        apply(factory.create(state, state.hostPlayerId, 'SET_FIXED_PRICE', { amount: hostCash > 0 ? 1 : 0 }));
      } else {
        const actor = auction.actingPlayerId;
        const canAfford = (state.players[actor]?.cash ?? 0) >= (auction.fixedPrice ?? 0);
        apply(factory.create(state, actor, 'RESPOND_FIXED_PRICE', { accept: canAfford }));
      }
      continue;
    }

    if (auction.type === 'SEQUENTIAL') {
      const actor = auction.actingPlayerId;
      const bid = auction.currentBidderId === undefined ? affordableBid(state, actor, 1) : null;
      if (bid === null) {
        apply(factory.create(state, actor, 'PASS_SEQUENTIAL', {}));
      } else {
        apply(factory.create(state, actor, 'PLACE_SEQUENTIAL_BID', { amount: bid }));
      }
      continue;
    }

    if (auction.type === 'SEALED_BID') {
      const missing = state.seatOrder.filter((id) => auction.bids[id] === undefined);
      if (auction.stolen) {
        const target = state.seatOrder[0]!;
        for (const playerId of missing) {
          if (playerId === state.hostPlayerId && playerId !== target) continue;
          const cash = state.players[playerId]?.cash ?? 0;
          const amount = playerId === target ? 0 : Math.min(Math.max(cash, 0), 50);
          apply(factory.create(state, playerId, 'SUBMIT_SEALED_BID', { amount }));
        }
      } else {
        for (const playerId of missing) {
          const cash = state.players[playerId]?.cash ?? 0;
          if (cash > 0) apply(factory.create(state, playerId, 'SUBMIT_SEALED_BID', { amount: 1 }));
        }
      }
      timeout = true;
      const active = state.auction;
      if (!active || active.type !== 'SEALED_BID') throw new Error('Sealed auction disappeared');
      apply(factory.create(state, state.hostPlayerId, 'EXPIRE_AUCTION', {}), Date.parse(active.expiresAt));
      continue;
    }

    if (auction.type === 'JOINT') {
      if (auction.phase === 'CHOOSING_MODE') {
        const possiblePartner = state.seatOrder
          .filter((id) => id !== auction.oldHostId)
          .find((id) => findJointCompanion(state, auction, id) !== undefined);
        if (possiblePartner !== undefined) {
          apply(factory.create(state, auction.oldHostId, 'INVITE_JOINT_PLAYER', {}));
        } else {
          const selfCard = findJointCompanion(state, auction, auction.oldHostId);
          if (selfCard) {
            apply(factory.create(state, auction.oldHostId, 'CHOOSE_SELF_JOINT_CARD', { cardId: selfCard.id }));
          } else {
            apply(factory.create(state, auction.oldHostId, 'INVITE_JOINT_PLAYER', {}));
          }
        }
      } else {
        const actor = auction.actingPlayerId;
        const companion = findJointCompanion(state, auction, actor);
        if (companion) {
          jointPartnerAuction = true;
          apply(factory.create(state, actor, 'RESPOND_JOINT_INVITE', { accept: true, cardId: companion.id }));
        } else {
          apply(factory.create(state, actor, 'RESPOND_JOINT_INVITE', { accept: false }));
        }
      }
    }
  }

  return {
    state,
    standings: rankPlayers(Object.values(state.players)),
    eventSequences,
    stateVersions,
    uniqueCardLocations,
    privateViewsSafe,
    coverage: {
      auctionTypes: [...coveredTypes],
      stolenSealedBid,
      jointPartnerAuction,
      timeout,
      negativeBalance,
    },
  };
}
