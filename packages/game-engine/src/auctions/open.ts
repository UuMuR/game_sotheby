import type { Money } from '@sotheby/contracts';

import type { CommandError, Deadline } from '../commands.ts';
import type { GameState, OpenAuctionState } from '../model.ts';
import { settleAuctionPurchase, type SettlementResult } from './payment.ts';

export const OPEN_AUCTION_SECONDS = 30;

export function placeOpenBid(
  state: GameState,
  auction: OpenAuctionState,
  playerId: string,
  amount: Money,
  now: Date,
): { auction: OpenAuctionState; deadline: Deadline } | CommandError {
  const player = state.players[playerId];
  if (player === undefined) return { code: 'PLAYER_NOT_FOUND', message: 'Player is not seated' };
  if (now.getTime() >= Date.parse(auction.expiresAt)) {
    return { code: 'AUCTION_EXPIRED', message: 'The auction deadline has passed' };
  }
  if (player.cash <= 0) return { code: 'PLAYER_NOT_ELIGIBLE', message: 'Player has no available cash' };
  if (!Number.isInteger(amount) || amount < 1) {
    return { code: 'INVALID_AMOUNT', message: 'Bid must be a positive whole unit' };
  }
  if (amount <= auction.currentPrice) {
    return { code: 'INVALID_INCREMENT', message: 'Bid must exceed the current price' };
  }
  if (amount > player.cash) return { code: 'INSUFFICIENT_CASH', message: 'Bid exceeds cash balance' };

  const expiresAt = new Date(now.getTime() + OPEN_AUCTION_SECONDS * 1000).toISOString();
  return {
    auction: { ...auction, currentPrice: amount, currentBidderId: playerId, expiresAt },
    deadline: {
      id: `${state.gameId}:open:${state.stateVersion + 1}`,
      roomId: state.roomId,
      gameId: state.gameId,
      expectedStateVersion: state.stateVersion + 1,
      expiresAt,
      action: 'EXPIRE_AUCTION',
    },
  };
}

export function expireOpenAuction(state: GameState, auction: OpenAuctionState, now: Date): SettlementResult | CommandError {
  if (now.getTime() < Date.parse(auction.expiresAt)) {
    return { code: 'AUCTION_NOT_EXPIRED', message: 'The auction is still active' };
  }
  return settleAuctionPurchase(
    state,
    auction,
    auction.currentBidderId ?? state.hostPlayerId,
    auction.currentBidderId === undefined ? 0 : auction.currentPrice,
  );
}
