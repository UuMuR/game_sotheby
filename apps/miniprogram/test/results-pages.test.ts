import { describe, expect, it } from 'vitest';

import type { RequestOptions } from '../miniprogram/services/http.ts';

import { createFinalResultModel } from '../miniprogram/pages/final-result/view-model.ts';
import { createHistoryModel } from '../miniprogram/pages/history/view-model.ts';
import { createRoundResultModel } from '../miniprogram/pages/round-result/view-model.ts';
import { RULE_SECTIONS } from '../miniprogram/pages/rules/content.ts';

describe('round result page model', () => {
  it('orders series and explains balance changes', () => {
    const model = createRoundResultModel({
      round: 2,
      rankings: [{ series: 'BLACK', count: 5, addedPrice: 30, cumulativePrice: 50 }],
      ledger: [{ reason: 'STOLEN_FINE', cardName: '黑曜王冠', delta: -60, before: 20, after: -40 }],
      balance: -40,
    });
    expect(model.title).toBe('第 2 阶段结算');
    expect(model.ledger[0]?.amountLabel).toBe('-60 万');
    expect(model.balanceLabel).toBe('负债 40 万');
  });
});

describe('final result page model', () => {
  it('marks every first-place tie as a winner', () => {
    const model = createFinalResultModel([
      { playerId: 'p1', nickname: '甲', cash: 30, place: 1, winner: true },
      { playerId: 'p2', nickname: '乙', cash: 30, place: 1, winner: true },
      { playerId: 'p3', nickname: '丙', cash: -10, place: 3, winner: false },
    ]);
    expect(model.winnerNames).toEqual(['甲', '乙']);
    expect(model.rows[2]?.cashLabel).toBe('负债 10 万');
  });
});

describe('rules and history', () => {
  it('contains all rule topics and formats history rows', () => {
    expect(RULE_SECTIONS.map((section) => section.id)).toEqual(['overview', 'cards', 'auctions', 'settlement', 'stolen', 'connection']);
    expect(createHistoryModel([{ gameId: 'g1', roomCode: '123456', finishedAt: '2026-09-01T10:00:00.000Z', playerCount: 4, cash: -5, place: 2 }])[0]).toMatchObject({ resultLabel: '第 2 名', cashLabel: '负债 5 万' });
  });
});

describe('live game result adapters', () => {
  it('builds the current player round result from a game view', async () => {
    const { roundResultInputFromGameView } = await import('../miniprogram/pages/round-result/view-model.ts');
    const input = roundResultInputFromGameView({
      roomId: 'r1', gameId: 'g1', status: 'ROUND_SETTLEMENT', stateVersion: 9, eventSequence: 8,
      round: 2, hostPlayerId: 'p1',
      self: { id: 'p2', nickname: '乙', avatarUrl: '/2.png', seat: 1, online: true, isHost: false, isActing: false, purchasedCards: [], handCount: 3, cash: -40, hand: [] },
      players: [], seriesCounts: { BLACK: 1, BLUE: 5, GREEN: 3, YELLOW: 2, RED: 0 },
      cumulativeSeriesPrices: { BLACK: 20, BLUE: 50, GREEN: 10, YELLOW: 0, RED: 0 }, auction: null,
      lastRoundSettlement: { round: 2, rankings: [{ series: 'BLUE', count: 5, addedPrice: 30 }], ledger: [{ playerId: 'p2', reason: 'STOLEN_FINE', counterparty: 'BANK', before: 20, delta: -60, after: -40, cardId: 'BL-004' }] },
    });
    expect(input.balance).toBe(-40);
    expect(input.rankings[0]).toMatchObject({ series: 'BLUE', cumulativePrice: 50 });
    expect(input.ledger[0]).toMatchObject({ cardName: expect.any(String), delta: -60 });
  });

  it('adds player names to final standings from the live game view', async () => {
    const { finalStandingsFromGameView } = await import('../miniprogram/pages/final-result/view-model.ts');
    const standings = finalStandingsFromGameView({
      roomId: 'r1', gameId: 'g1', status: 'FINISHED', stateVersion: 10, eventSequence: 9,
      round: 4, hostPlayerId: 'p1',
      self: { id: 'p1', nickname: '甲', avatarUrl: '/1.png', seat: 0, online: true, isHost: true, isActing: false, purchasedCards: [], handCount: 0, cash: 20, hand: [] },
      players: [{ id: 'p1', nickname: '甲', avatarUrl: '/1.png', seat: 0, online: true, isHost: true, isActing: false, purchasedCards: [], handCount: 0 }, { id: 'p2', nickname: '乙', avatarUrl: '/2.png', seat: 1, online: true, isHost: false, isActing: false, purchasedCards: [], handCount: 0 }],
      seriesCounts: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 }, cumulativeSeriesPrices: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 }, auction: null,
      finalStandings: [{ playerId: 'p1', cash: 20, place: 1, winner: true }, { playerId: 'p2', cash: 20, place: 1, winner: true }],
    });
    expect(standings.map((standing) => standing.nickname)).toEqual(['甲', '乙']);
  });

  it('maps result and history requests to authenticated APIs', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const { createResultClient } = await import('../miniprogram/services/results.ts');
    const client = createResultClient({ async request<T>(options: RequestOptions) { calls.push(options); return [] as T; } });
    await client.getResult('g1');
    await client.getHistory();
    expect(calls).toEqual([{ url: '/v1/games/g1/result', method: 'GET' }, { url: '/v1/me/game-history', method: 'GET' }]);
  });
});

describe('page controller helpers', () => {
  it('builds a round page state and next-round command from live state', async () => {
    const { createRoundResultPageState, nextRoundCommand } = await import('../miniprogram/pages/round-result/controller.ts');
    const source = {
      roomId: 'r1', gameId: 'g1', status: 'ROUND_SETTLEMENT' as const, stateVersion: 9, eventSequence: 8,
      round: 2 as const, hostPlayerId: 'p1',
      self: { id: 'p2', nickname: '乙', avatarUrl: '/2.png', seat: 1, online: true, isHost: false, isActing: false, purchasedCards: [], handCount: 3, cash: -40, hand: [] },
      players: [], seriesCounts: { BLACK: 1, BLUE: 5, GREEN: 3, YELLOW: 2, RED: 0 },
      cumulativeSeriesPrices: { BLACK: 20, BLUE: 50, GREEN: 10, YELLOW: 0, RED: 0 }, auction: null,
      lastRoundSettlement: { round: 2 as const, rankings: [{ series: 'BLUE' as const, count: 5, addedPrice: 30 }], ledger: [] },
    };
    expect(createRoundResultPageState(source).model.title).toBe('第 2 阶段结算');
    expect(nextRoundCommand()).toEqual({ type: 'ADVANCE_AFTER_SETTLEMENT', payload: {} });
  });

  it('maps a completed API result into the final result model', async () => {
    const { finalResultModelFromResponse } = await import('../miniprogram/pages/final-result/controller.ts');
    const model = finalResultModelFromResponse({
      gameId: 'g1', roomCode: '123456', finishedAt: '2026-09-01T10:00:00.000Z', publicRoundSummaries: [], privateLedger: [],
      finalStandings: [{ playerId: 'p1', nickname: '甲', cash: 20, place: 1, winner: true }],
    });
    expect(model.winnerLabel).toBe('甲');
  });
});
