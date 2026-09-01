import type { CardDefinition, Money } from '@sotheby/contracts';

import type { CashTransfer, SettlementResult } from './payment.ts';
import type { GameState, JointPartnerContext, PlayerState } from '../model.ts';
import { areAllHandsEmpty } from '../rounds/end-condition.ts';
import { nextSeatPlayerId } from '../turns.ts';

export function splitJointPrice(price: Money): { oldHostShare: Money; newHostShare: Money } {
  return {
    oldHostShare: Math.ceil(price / 2),
    newHostShare: Math.floor(price / 2),
  };
}

export type JointCompanionCard = CardDefinition & {
  auctionType: Exclude<CardDefinition['auctionType'], 'JOINT'>;
  stolen: false;
};

export function isValidJointCard(
  initial: CardDefinition,
  candidate: CardDefinition,
): candidate is JointCompanionCard {
  return (
    candidate.id !== initial.id &&
    candidate.series === initial.series &&
    !candidate.stolen &&
    candidate.auctionType !== 'JOINT'
  );
}

export function settleJointPurchase(
  state: GameState,
  context: JointPartnerContext,
  buyerId: string,
  price: Money,
  cards: readonly CardDefinition[],
): SettlementResult {
  const buyer = state.players[buyerId];
  const oldHost = state.players[context.oldHostId];
  const newHost = state.players[context.newHostId];
  if (!buyer || !oldHost || !newHost) throw new Error('Joint auction players must be seated');

  const { oldHostShare, newHostShare } = splitJointPrice(price);
  const players = { ...state.players } as Record<string, PlayerState>;
  const transfers: CashTransfer[] = [];

  if (buyerId === context.oldHostId) {
    players[buyerId] = { ...buyer, cash: buyer.cash - price, purchasedCards: [...buyer.purchasedCards, ...cards] };
    players[context.newHostId] = { ...newHost, cash: newHost.cash + newHostShare };
    if (newHostShare > 0) transfers.push({ from: buyerId, to: context.newHostId, amount: newHostShare });
    if (oldHostShare > 0) transfers.push({ from: buyerId, to: 'BANK', amount: oldHostShare });
  } else if (buyerId === context.newHostId) {
    players[buyerId] = { ...buyer, cash: buyer.cash - oldHostShare, purchasedCards: [...buyer.purchasedCards, ...cards] };
    players[context.oldHostId] = { ...oldHost, cash: oldHost.cash + oldHostShare };
    if (oldHostShare > 0) transfers.push({ from: buyerId, to: context.oldHostId, amount: oldHostShare });
  } else {
    players[buyerId] = { ...buyer, cash: buyer.cash - price, purchasedCards: [...buyer.purchasedCards, ...cards] };
    players[context.oldHostId] = { ...oldHost, cash: oldHost.cash + oldHostShare };
    players[context.newHostId] = { ...newHost, cash: newHost.cash + newHostShare };
    if (oldHostShare > 0) transfers.push({ from: buyerId, to: context.oldHostId, amount: oldHostShare });
    if (newHostShare > 0) transfers.push({ from: buyerId, to: context.newHostId, amount: newHostShare });
  }

  const seriesCounts = { ...state.seriesCounts };
  for (const card of cards) seriesCounts[card.series] += 1;

  const afterPurchase: GameState = { ...state, players, seriesCounts, auction: null };
  const roundEnded = areAllHandsEmpty(afterPurchase);
  return {
    state: {
      ...afterPurchase,
      status: roundEnded ? 'ROUND_SETTLEMENT' : state.status,
      hostPlayerId: roundEnded ? context.oldHostId : nextSeatPlayerId(state, context.newHostId),
      ...(roundEnded ? { roundEndHostPlayerId: context.oldHostId } : {}),
    },
    transfers,
  };
}
