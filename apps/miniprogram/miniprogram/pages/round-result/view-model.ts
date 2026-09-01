import type { PlayerGameView } from '@sotheby/contracts';

import { CARD_BY_ID } from '../../data/cards.ts';

export interface RoundResultInput {
  round: 1 | 2 | 3 | 4;
  rankings: readonly {
    series: string;
    count: number;
    addedPrice: number;
    cumulativePrice: number;
  }[];
  ledger: readonly {
    reason: 'COLLECTION_SALE' | 'STOLEN_FINE';
    cardName: string;
    delta: number;
    before: number;
    after: number;
  }[];
  balance: number;
}

export function moneyLabel(value: number): string {
  return value < 0 ? `负债 ${Math.abs(value)} 万` : `${value} 万`;
}

export function signedMoneyLabel(value: number): string {
  return `${value > 0 ? '+' : ''}${value} 万`;
}

export function createRoundResultModel(input: RoundResultInput) {
  return {
    title: `第 ${input.round} 阶段结算`,
    rankings: input.rankings,
    ledger: input.ledger.map((entry) => ({
      ...entry,
      reasonLabel: entry.reason === 'COLLECTION_SALE' ? '藏品回收' : '失窃罚款',
      amountLabel: signedMoneyLabel(entry.delta),
      afterLabel: moneyLabel(entry.after),
    })),
    balanceLabel: moneyLabel(input.balance),
  };
}


export function roundResultInputFromGameView(view: PlayerGameView): RoundResultInput {
  const settlement = view.lastRoundSettlement;
  if (!settlement) throw new Error('ROUND_SETTLEMENT_MISSING');
  return {
    round: settlement.round,
    rankings: settlement.rankings.map((ranking) => ({
      ...ranking,
      cumulativePrice: view.cumulativeSeriesPrices[ranking.series],
    })),
    ledger: settlement.ledger.map((entry) => ({
      reason: entry.reason,
      cardName: CARD_BY_ID.get(entry.cardId)?.name ?? entry.cardId,
      delta: entry.delta,
      before: entry.before,
      after: entry.after,
    })),
    balance: view.self.cash,
  };
}
