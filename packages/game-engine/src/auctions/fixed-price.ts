import type { Money } from '@sotheby/contracts';

import type { CommandError, Deadline } from '../commands.ts';
import type { FixedPriceAuctionState, GameState } from '../model.ts';
import { nextEligibleBuyerAfter } from '../turns.ts';
import { settleStandardPurchase, type SettlementResult } from './payment.ts';

const PRICE_SECONDS = 60;
const RESPONSE_SECONDS = 30;

function responseDeadline(state: GameState, expiresAt: string): Deadline {
  return {
    id: `${state.gameId}:fixed:${state.stateVersion + 1}`,
    roomId: state.roomId,
    gameId: state.gameId,
    expectedStateVersion: state.stateVersion + 1,
    expiresAt,
    action: 'EXPIRE_AUCTION',
  };
}

export function initialFixedPriceDeadline(state: GameState, now: Date): Deadline {
  return responseDeadline(state, new Date(now.getTime() + PRICE_SECONDS * 1000).toISOString());
}

export function setFixedPrice(
  state: GameState,
  auction: FixedPriceAuctionState,
  playerId: string,
  amount: Money,
  now: Date,
): { auction: FixedPriceAuctionState; deadline?: Deadline } | SettlementResult | CommandError {
  if (playerId !== state.hostPlayerId) return { code: 'NOT_HOST', message: 'Only the host sets the price' };
  if (now.getTime() >= Date.parse(auction.expiresAt)) return { code: 'AUCTION_EXPIRED', message: 'Pricing expired' };
  if (!Number.isInteger(amount) || amount < 0) return { code: 'INVALID_AMOUNT', message: 'Price must be a whole nonnegative unit' };
  const host = state.players[playerId];
  if (host === undefined) return { code: 'PLAYER_NOT_FOUND', message: 'Host is not seated' };
  const invalidForBalance = host.cash <= 0 ? amount !== 0 : amount > host.cash;
  if (invalidForBalance) {
    return { code: 'INSUFFICIENT_CASH', message: 'Price exceeds host cash allowance' };
  }
  return beginOffers(state, auction, amount, now);
}

export function beginOffers(
  state: GameState,
  auction: FixedPriceAuctionState,
  amount: Money,
  now: Date,
): { auction: FixedPriceAuctionState; deadline?: Deadline } | SettlementResult {
  const next = nextEligibleBuyerAfter(state, state.hostPlayerId, state.hostPlayerId);
  if (next === null) return settleStandardPurchase(state, state.hostPlayerId, state.hostPlayerId, amount, auction.cards);
  const expiresAt = new Date(now.getTime() + RESPONSE_SECONDS * 1000).toISOString();
  return {
    auction: { ...auction, phase: 'OFFERING', fixedPrice: amount, actingPlayerId: next, expiresAt },
    deadline: responseDeadline(state, expiresAt),
  };
}

export function respondFixedPrice(
  state: GameState,
  auction: FixedPriceAuctionState,
  playerId: string,
  accept: boolean,
  now: Date,
): { auction: FixedPriceAuctionState; deadline: Deadline } | SettlementResult | CommandError {
  if (auction.phase !== 'OFFERING' || auction.actingPlayerId !== playerId) {
    return { code: 'NOT_YOUR_TURN', message: 'It is not this player\'s decision' };
  }
  if (now.getTime() >= Date.parse(auction.expiresAt)) return { code: 'AUCTION_EXPIRED', message: 'Decision expired' };
  const price = auction.fixedPrice ?? 0;
  if (accept) return settleStandardPurchase(state, state.hostPlayerId, playerId, price, auction.cards);

  const next = nextEligibleBuyerAfter(state, playerId, state.hostPlayerId);
  if (next === null) return settleStandardPurchase(state, state.hostPlayerId, state.hostPlayerId, price, auction.cards);
  const expiresAt = new Date(now.getTime() + RESPONSE_SECONDS * 1000).toISOString();
  return {
    auction: { ...auction, actingPlayerId: next, expiresAt },
    deadline: responseDeadline(state, expiresAt),
  };
}
