import type { Money } from '@sotheby/contracts';

import type { GameState, PlayerState, RoundNumber } from '../model.ts';
import { nextSeatPlayerId } from '../turns.ts';
import { rankPlayers, type FinalStanding } from '../game-result.ts';
import { rankSeries, type RankedSeries } from './ranking.ts';
import { refillForRound } from './refill.ts';

export type LedgerReason = 'COLLECTION_SALE' | 'STOLEN_FINE';

export interface LedgerEntry {
  playerId: string;
  reason: LedgerReason;
  counterparty: 'BANK';
  before: Money;
  delta: Money;
  after: Money;
  cardId: string;
}

export interface RoundSettlement {
  state: GameState;
  rankings: readonly RankedSeries[];
  ledger: readonly LedgerEntry[];
}

export function applyIncome(
  balance: Money,
  amount: Money,
): { balance: Money; debtRepaid: Money; availableIncome: Money } {
  const debt = Math.max(0, -balance);
  const debtRepaid = Math.min(debt, amount);
  return {
    balance: balance + amount,
    debtRepaid,
    availableIncome: amount - debtRepaid,
  };
}

export function settleRound(state: GameState): RoundSettlement {
  if (state.status !== 'ROUND_SETTLEMENT') {
    throw new Error('Round can only be settled from ROUND_SETTLEMENT state');
  }

  if (state.lastRoundSettlement?.round === state.round) {
    return {
      state,
      rankings: state.lastRoundSettlement.rankings,
      ledger: state.lastRoundSettlement.ledger,
    };
  }

  const rankings = rankSeries(state.seriesCounts);
  const cumulativeSeriesPrices = { ...state.cumulativeSeriesPrices };
  for (const ranking of rankings) {
    cumulativeSeriesPrices[ranking.series] += ranking.addedPrice;
  }

  const players = { ...state.players } as Record<string, PlayerState>;
  const ledger: LedgerEntry[] = [];
  const reclaimed = [];

  for (const playerId of state.seatOrder) {
    const player = players[playerId];
    if (!player) throw new Error(`Seat references missing player ${playerId}`);
    let cash = player.cash;

    for (const ownedCard of player.purchasedCards) {
      const value = cumulativeSeriesPrices[ownedCard.series] * ownedCard.rarity;
      const delta = ownedCard.stolen && value !== 0 ? -value : value;
      const before = cash;
      cash += delta;
      ledger.push({
        playerId,
        reason: ownedCard.stolen ? 'STOLEN_FINE' : 'COLLECTION_SALE',
        counterparty: 'BANK',
        before,
        delta,
        after: cash,
        cardId: ownedCard.id,
      });
      reclaimed.push(ownedCard);
    }

    players[playerId] = { ...player, cash, purchasedCards: [] };
  }

  const snapshot = { round: state.round, rankings, ledger };
  return {
    state: {
      ...state,
      players,
      discardedCards: [...state.discardedCards, ...reclaimed],
      cumulativeSeriesPrices,
      auction: null,
      lastRoundSettlement: snapshot,
    },
    rankings,
    ledger,
  };
}

export function advanceAfterSettlement(state: GameState): GameState {
  if (state.status !== 'ROUND_SETTLEMENT') {
    throw new Error('Can only advance after round settlement');
  }

  const { roundEndHostPlayerId, ...baseState } = state;
  if (state.round === 4) {
    const finalStandings: readonly FinalStanding[] = rankPlayers(Object.values(state.players));
    return { ...baseState, status: 'FINISHED', auction: null, finalStandings };
  }

  const nextRound = (state.round + 1) as RoundNumber;
  const hostBasis = roundEndHostPlayerId ?? state.hostPlayerId;
  const refilled = refillForRound(state, nextRound);
  return {
    ...baseState,
    ...refilled,
    status: 'IN_PROGRESS',
    round: nextRound,
    hostPlayerId: nextSeatPlayerId(state, hostBasis),
    seriesCounts: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 },
    auction: null,
  };
}
