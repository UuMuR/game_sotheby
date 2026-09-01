import { describe, expect, it } from 'vitest';

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
