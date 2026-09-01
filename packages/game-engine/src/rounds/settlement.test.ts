import { describe, expect, it } from 'vitest';

import type { CardDefinition, CollectionSeries } from '@sotheby/contracts';

import type { CommandResult } from '../commands.ts';
import { loadPlaceholderCatalog } from '../catalog.ts';
import { initializeGame } from '../initialize.ts';
import type { GameCommandInput, GameState, PlayerState } from '../model.ts';
import { createSeededRandom } from '../random.ts';
import { handleCommand } from '../reducer.ts';
import { checkRoundEnd } from './end-condition.ts';
import { rankSeries } from './ranking.ts';
import { advanceAfterSettlement, applyIncome, settleRound } from './settlement.ts';

const NOW = new Date('2026-09-01T08:00:00.000Z');

function card(
  id: string,
  series: CollectionSeries,
  rarity: 1 | 2 | 3 | 4 | 5,
  stolen = false,
  auctionType: CardDefinition['auctionType'] = stolen ? 'SEALED_BID' : 'OPEN',
): CardDefinition {
  return { id, name: id, series, rarity, stolen, auctionType, imageKey: id.toLowerCase() };
}

function baseState(): GameState {
  return initializeGame({
    roomId: 'room-1',
    gameId: 'game-1',
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
    catalog: loadPlaceholderCatalog(),
    randomSource: createSeededRandom(10),
  });
}

function replacePlayers(state: GameState, replacements: Record<string, Partial<PlayerState>>): GameState {
  return {
    ...state,
    players: Object.fromEntries(Object.entries(state.players).map(([id, player]) => [
      id,
      { ...player, ...replacements[id] },
    ])),
  };
}

function command<T extends GameCommandInput['type']>(state: GameState, playerId: string, type: T, payload: Extract<GameCommandInput, { type: T }>['payload']): Extract<GameCommandInput, { type: T }> {
  return { requestId: `${type}-${state.stateVersion}-${playerId}`, playerId, stateVersion: state.stateVersion, type, payload } as Extract<GameCommandInput, { type: T }>;
}

function succeed(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

describe('round ending', () => {
  it('voids a normal sixth card and enters round settlement', () => {
    const trigger = card('trigger', 'BLUE', 3);
    let state = replacePlayers(baseState(), { p1: { hand: [trigger] } });
    state = { ...state, hostPlayerId: 'p1', seriesCounts: { ...state.seriesCounts, BLUE: 5 } };

    const result = succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId: trigger.id }), NOW));

    expect(result.state.status).toBe('ROUND_SETTLEMENT');
    expect(result.state.auction).toBeNull();
    expect(result.state.discardedCards.map((item) => item.id)).toContain('trigger');
    expect(result.state.seriesCounts.BLUE).toBe(5);
  });

  it('voids both joint cards when the second card becomes the sixth', () => {
    const joint = card('joint', 'GREEN', 2, false, 'JOINT');
    const second = card('second', 'GREEN', 4, false, 'OPEN');
    let state = replacePlayers(baseState(), { p1: { hand: [joint, second] } });
    state = { ...state, hostPlayerId: 'p1', seriesCounts: { ...state.seriesCounts, GREEN: 4 } };

    state = succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId: joint.id }), NOW)).state;
    const result = succeed(handleCommand(state, command(state, 'p1', 'CHOOSE_SELF_JOINT_CARD', { cardId: second.id }), new Date(NOW.getTime() + 1000)));

    expect(result.state.status).toBe('ROUND_SETTLEMENT');
    expect(result.state.auction).toBeNull();
    expect(result.state.discardedCards.map((item) => item.id)).toEqual(expect.arrayContaining(['joint', 'second']));
    expect(result.state.seriesCounts.GREEN).toBe(4);
  });

  it('ends when all player hands are empty after a sale', () => {
    const offered = card('last', 'RED', 1);
    let state = replacePlayers(baseState(), {
      p1: { hand: [offered] },
      p2: { hand: [] },
      p3: { hand: [] },
    });
    state = { ...state, hostPlayerId: 'p1' };
    state = succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId: offered.id }), NOW)).state;
    const result = succeed(handleCommand(state, command(state, 'p1', 'EXPIRE_AUCTION', {}), new Date(NOW.getTime() + 30_000)));

    expect(result.state.status).toBe('ROUND_SETTLEMENT');
  });

  it('reports whether a sequence of joint cards triggers the sixth-card rule', () => {
    const first = card('fifth', 'BLACK', 1, false, 'JOINT');
    const second = card('sixth', 'BLACK', 1);
    const state = { ...baseState(), seriesCounts: { BLACK: 4, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 } };

    expect(checkRoundEnd(state, [first])).toEqual({ ended: false });
    expect(checkRoundEnd(state, [first, second])).toMatchObject({ ended: true, triggerCardId: 'sixth', voidCardIds: ['fifth', 'sixth'] });
  });
});

describe('round ranking and settlement', () => {
  it('ranks by count then BLACK > BLUE > GREEN > YELLOW > RED', () => {
    expect(rankSeries({ BLACK: 2, BLUE: 2, GREEN: 4, YELLOW: 1, RED: 2 })).toEqual([
      { series: 'GREEN', count: 4, addedPrice: 30 },
      { series: 'BLACK', count: 2, addedPrice: 20 },
      { series: 'BLUE', count: 2, addedPrice: 10 },
      { series: 'RED', count: 2, addedPrice: 0 },
      { series: 'YELLOW', count: 1, addedPrice: 0 },
    ]);
  });

  it('pays normal cards, fines valuable stolen cards, and carries negative debt', () => {
    const normal = card('normal', 'BLACK', 2);
    const stolen = card('stolen', 'BLUE', 3, true);
    const zeroStolen = card('zero-stolen', 'RED', 5, true);
    let state = replacePlayers(baseState(), {
      p1: { cash: 10, hand: [], purchasedCards: [normal, stolen, zeroStolen] },
      p2: { hand: [], purchasedCards: [card('g1', 'GREEN', 1), card('g2', 'GREEN', 1), card('g3', 'GREEN', 1)] },
      p3: { hand: [], purchasedCards: [card('b2', 'BLUE', 1)] },
    });
    state = {
      ...state,
      status: 'ROUND_SETTLEMENT',
      seriesCounts: { BLACK: 1, BLUE: 2, GREEN: 3, YELLOW: 0, RED: 1 },
      cumulativeSeriesPrices: { BLACK: 10, BLUE: 10, GREEN: 0, YELLOW: 0, RED: 0 },
    };

    const result = settleRound(state);

    expect(result.rankings.slice(0, 3).map((item) => item.series)).toEqual(['GREEN', 'BLUE', 'BLACK']);
    expect(result.state.cumulativeSeriesPrices).toEqual({ BLACK: 20, BLUE: 30, GREEN: 30, YELLOW: 0, RED: 0 });
    expect(result.state.players.p1?.cash).toBe(-40);
    expect(result.ledger.filter((entry) => entry.playerId === 'p1')).toEqual([
      expect.objectContaining({ reason: 'COLLECTION_SALE', delta: 40 }),
      expect.objectContaining({ reason: 'STOLEN_FINE', delta: -90 }),
      expect.objectContaining({ reason: 'STOLEN_FINE', delta: 0 }),
    ]);
    expect(Object.values(result.state.players).every((player) => player.purchasedCards.length === 0)).toBe(true);
  });

  it('applies later income to a negative balance before it becomes available cash', () => {
    expect(applyIncome(-40, 70)).toEqual({ balance: 30, debtRepaid: 40, availableIncome: 30 });
    expect(applyIncome(-40, 20)).toEqual({ balance: -20, debtRepaid: 20, availableIncome: 0 });
  });

  it('refills rounds two and three, and finishes after round four', () => {
    let state = replacePlayers(baseState(), { p1: { hand: [] }, p2: { hand: [] }, p3: { hand: [] } });
    state = { ...state, status: 'ROUND_SETTLEMENT', hostPlayerId: 'p1' };

    const roundTwo = advanceAfterSettlement(state);
    expect(roundTwo.round).toBe(2);
    expect(roundTwo.status).toBe('IN_PROGRESS');
    expect(roundTwo.hostPlayerId).toBe('p2');
    expect(Object.values(roundTwo.players).every((player) => player.hand.length === 8)).toBe(true);

    const roundThree = advanceAfterSettlement({ ...roundTwo, status: 'ROUND_SETTLEMENT' });
    expect(roundThree.round).toBe(3);
    expect(Object.values(roundThree.players).every((player) => player.hand.length === 16)).toBe(true);

    const roundFour = advanceAfterSettlement({ ...roundThree, status: 'ROUND_SETTLEMENT' });
    expect(roundFour.round).toBe(4);
    expect(Object.values(roundFour.players).every((player) => player.hand.length === 16)).toBe(true);

    const finished = advanceAfterSettlement({ ...roundFour, status: 'ROUND_SETTLEMENT' });
    expect(finished.status).toBe('FINISHED');
  });
});

describe('round settlement command flow', () => {
  it('attaches a player-specific settlement view when a played card ends the round', () => {
    const trigger = card('trigger-summary', 'BLUE', 3);
    const owned = card('owned-summary', 'BLACK', 2);
    let state = replacePlayers(baseState(), {
      p1: { hand: [trigger], purchasedCards: [owned] },
      p2: { hand: [] },
      p3: { hand: [] },
    });
    state = { ...state, hostPlayerId: 'p1', seriesCounts: { BLACK: 1, BLUE: 5, GREEN: 0, YELLOW: 0, RED: 0 } };

    const result = succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId: trigger.id }), NOW));

    expect(result.state.status).toBe('ROUND_SETTLEMENT');
    expect(result.state.lastRoundSettlement?.round).toBe(1);
    expect(result.state.lastRoundSettlement?.rankings[0]).toMatchObject({ series: 'BLUE', addedPrice: 30 });
    expect(result.state.lastRoundSettlement?.ledger).toContainEqual(expect.objectContaining({ playerId: 'p1', cardId: 'owned-summary', delta: 40 }));
    expect(result.state.players.p1?.purchasedCards).toEqual([]);
  });

  it('advances a settled round and publishes final standings after round four', () => {
    let state = replacePlayers(baseState(), { p1: { cash: 20 }, p2: { cash: 20 }, p3: { cash: -5 } });
    state = { ...state, round: 4, status: 'ROUND_SETTLEMENT', lastRoundSettlement: { round: 4, rankings: [], ledger: [] } };

    const result = succeed(handleCommand(state, command(state, 'p1', 'ADVANCE_AFTER_SETTLEMENT', {}), NOW));

    expect(result.state.status).toBe('FINISHED');
    expect(result.state.finalStandings).toEqual([
      { playerId: 'p1', cash: 20, place: 1, winner: true },
      { playerId: 'p2', cash: 20, place: 1, winner: true },
      { playerId: 'p3', cash: -5, place: 3, winner: false },
    ]);
  });
});

describe('settlement idempotency', () => {
  it('does not apply the same round settlement twice', () => {
    const owned = card('idempotent-owned', 'BLACK', 2);
    let state = replacePlayers(baseState(), { p1: { cash: 10, purchasedCards: [owned] } });
    state = { ...state, status: 'ROUND_SETTLEMENT', seriesCounts: { BLACK: 1, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 } };

    const first = settleRound(state).state;
    const second = settleRound(first).state;

    expect(second.players.p1?.cash).toBe(first.players.p1?.cash);
    expect(second.cumulativeSeriesPrices).toEqual(first.cumulativeSeriesPrices);
    expect(second.lastRoundSettlement).toEqual(first.lastRoundSettlement);
  });
});

describe('host rotation with depleted hands', () => {
  it('skips players without cards after a completed auction', () => {
    const offered = card('rotation-card', 'YELLOW', 1);
    let state = replacePlayers(baseState(), {
      p1: { hand: [offered] },
      p2: { hand: [] },
      p3: { hand: [card('remaining-card', 'RED', 1)] },
    });
    state = { ...state, hostPlayerId: 'p1' };
    state = succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId: offered.id }), NOW)).state;
    const result = succeed(handleCommand(state, command(state, 'p1', 'EXPIRE_AUCTION', {}), new Date(NOW.getTime() + 30_000)));

    expect(result.state.status).toBe('IN_PROGRESS');
    expect(result.state.hostPlayerId).toBe('p3');
  });
});
