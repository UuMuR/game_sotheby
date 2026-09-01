import type { CardDefinition, Money } from '@sotheby/contracts';

import type { ActiveAuctionState, GameState, PlayerState } from '../model.ts';
import { nextSeatPlayerId } from '../turns.ts';
import { settleJointPurchase } from './joint.ts';

export interface CashTransfer {
  from: string;
  to: string;
  amount: Money;
}

export interface SettlementResult {
  state: GameState;
  transfers: readonly CashTransfer[];
}

function standardSettlement(
  state: GameState,
  sellerId: string,
  nextHostBaseId: string,
  buyerId: string,
  price: Money,
  cards: readonly CardDefinition[],
): SettlementResult {
  const buyer = state.players[buyerId];
  const seller = state.players[sellerId];
  if (!buyer || !seller) throw new Error('Buyer and seller must be seated players');
  let players = state.players as Record<string, PlayerState>;
  const transfers: CashTransfer[] = [];
  if (buyerId === sellerId) {
    players = { ...players, [buyerId]: { ...buyer, cash: buyer.cash - price, purchasedCards: [...buyer.purchasedCards, ...cards] } };
    if (price > 0) transfers.push({ from: buyerId, to: 'BANK', amount: price });
  } else {
    players = {
      ...players,
      [buyerId]: { ...buyer, cash: buyer.cash - price, purchasedCards: [...buyer.purchasedCards, ...cards] },
      [sellerId]: { ...seller, cash: seller.cash + price },
    };
    if (price > 0) transfers.push({ from: buyerId, to: sellerId, amount: price });
  }
  const seriesCounts = { ...state.seriesCounts };
  for (const card of cards) seriesCounts[card.series] += 1;
  return { state: { ...state, players, seriesCounts, auction: null, hostPlayerId: nextSeatPlayerId(state, nextHostBaseId) }, transfers };
}

export function settleAuctionPurchase(state: GameState, auction: Exclude<ActiveAuctionState, { type: 'JOINT' }>, buyerId: string, price: Money): SettlementResult {
  if (auction.settlement.kind === 'JOINT_PARTNER') {
    return settleJointPurchase(state, auction.settlement, buyerId, price, auction.cards);
  }
  const sellerId = auction.settlement.kind === 'JOINT_SELF' ? auction.settlement.oldHostId : auction.settlement.sellerId;
  const nextHostBaseId = auction.settlement.kind === 'JOINT_SELF' ? auction.settlement.oldHostId : auction.settlement.nextHostBaseId;
  return standardSettlement(state, sellerId, nextHostBaseId, buyerId, price, auction.cards);
}

export function settleStandardPurchase(state: GameState, sellerId: string, buyerId: string, price: Money, cards: readonly CardDefinition[]): SettlementResult {
  return standardSettlement(state, sellerId, sellerId, buyerId, price, cards);
}
