import type { CardDefinition, Money } from '@sotheby/contracts';

import type { GameState, PlayerState } from '../model.ts';
import { nextSeatPlayerId } from '../turns.ts';

export interface CashTransfer {
  from: string;
  to: string;
  amount: Money;
}

export interface SettlementResult {
  state: GameState;
  transfers: readonly CashTransfer[];
}

function replacePlayer(state: GameState, player: PlayerState): Record<string, PlayerState> {
  return { ...state.players, [player.id]: player };
}

export function settleStandardPurchase(
  state: GameState,
  sellerId: string,
  buyerId: string,
  price: Money,
  cards: readonly CardDefinition[],
): SettlementResult {
  const buyer = state.players[buyerId];
  const seller = state.players[sellerId];
  if (buyer === undefined || seller === undefined) {
    throw new Error('Buyer and seller must be seated players');
  }

  let players = state.players as Record<string, PlayerState>;
  const transfers: CashTransfer[] = [];

  if (buyerId === sellerId) {
    players = replacePlayer(state, {
      ...buyer,
      cash: buyer.cash - price,
      purchasedCards: [...buyer.purchasedCards, ...cards],
    });
    if (price > 0) transfers.push({ from: buyerId, to: 'BANK', amount: price });
  } else {
    players = {
      ...players,
      [buyerId]: {
        ...buyer,
        cash: buyer.cash - price,
        purchasedCards: [...buyer.purchasedCards, ...cards],
      },
      [sellerId]: { ...seller, cash: seller.cash + price },
    };
    if (price > 0) transfers.push({ from: buyerId, to: sellerId, amount: price });
  }

  const seriesCounts = { ...state.seriesCounts };
  for (const card of cards) seriesCounts[card.series] += 1;

  return {
    state: {
      ...state,
      players,
      seriesCounts,
      auction: null,
      hostPlayerId: nextSeatPlayerId(state, sellerId),
    },
    transfers,
  };
}
