import type { Money } from '@sotheby/contracts';

import type { CommandError } from '../commands.ts';
import type { GameState, SealedBidAuctionState } from '../model.ts';
import { settleAuctionPurchase, type SettlementResult } from './payment.ts';

export interface SealedBidResolution extends SettlementResult {
  winnerId: string;
  bids: Readonly<Record<string, Money>>;
}

function seatPriority(state: GameState): readonly string[] {
  const hostIndex = state.seatOrder.indexOf(state.hostPlayerId);
  return [...state.seatOrder.slice(hostIndex + 1), ...state.seatOrder.slice(0, hostIndex + 1)];
}

export function submitSealedBid(
  state: GameState,
  auction: SealedBidAuctionState,
  playerId: string,
  amount: Money,
  now: Date,
): SealedBidAuctionState | CommandError {
  if (now.getTime() >= Date.parse(auction.expiresAt)) return { code: 'AUCTION_EXPIRED', message: 'Sealed bid expired' };
  const player = state.players[playerId];
  if (!player) return { code: 'PLAYER_NOT_FOUND', message: 'Player is not seated' };
  if (auction.bids[playerId] !== undefined) return { code: 'NOT_YOUR_TURN', message: 'Player already submitted a bid' };
  if (!Number.isInteger(amount)) return { code: 'INVALID_AMOUNT', message: 'Bid must be a whole unit' };

  if (auction.stolen) {
    if (amount < 0 || amount > Math.max(0, player.cash)) return { code: 'INSUFFICIENT_CASH', message: 'Bid exceeds cash balance' };
  } else {
    if (player.cash <= 0) return { code: 'PLAYER_NOT_ELIGIBLE', message: 'Player has no available cash' };
    if (amount < 1) return { code: 'INVALID_AMOUNT', message: 'Normal sealed bid must be positive' };
    if (amount > player.cash) return { code: 'INSUFFICIENT_CASH', message: 'Bid exceeds cash balance' };
  }

  return { ...auction, bids: { ...auction.bids, [playerId]: amount } };
}

export function resolveSealedBid(state: GameState, auction: SealedBidAuctionState): SealedBidResolution {
  const bids: Record<string, Money> = { ...auction.bids };
  if (auction.stolen) {
    for (const playerId of state.seatOrder) {
      if (playerId !== state.hostPlayerId && bids[playerId] === undefined) bids[playerId] = 0;
    }
  }

  const candidates = seatPriority(state).filter((playerId) => bids[playerId] !== undefined);
  if (candidates.length === 0) {
    const result = settleAuctionPurchase(state, auction, state.hostPlayerId, 0);
    return { ...result, winnerId: state.hostPlayerId, bids };
  }

  const winnerId = candidates.reduce((best, candidate) => {
    const bestBid = bids[best]!;
    const candidateBid = bids[candidate]!;
    return auction.stolen ? (candidateBid < bestBid ? candidate : best) : (candidateBid > bestBid ? candidate : best);
  });

  if (!auction.stolen) {
    const result = settleAuctionPurchase(state, auction, winnerId, bids[winnerId]!);
    return { ...result, winnerId, bids };
  }

  const players = { ...state.players };
  for (const [playerId, amount] of Object.entries(bids)) {
    const player = players[playerId];
    if (!player) continue;
    if (playerId === winnerId) {
      players[playerId] = { ...player, purchasedCards: [...player.purchasedCards, ...auction.cards] };
    } else {
      players[playerId] = { ...player, cash: player.cash - amount };
    }
  }
  const seriesCounts = { ...state.seriesCounts };
  for (const card of auction.cards) seriesCounts[card.series] += 1;
  return {
    state: { ...state, players, seriesCounts, auction: null, hostPlayerId: state.seatOrder[(state.seatOrder.indexOf(state.hostPlayerId) + 1) % state.seatOrder.length]! },
    transfers: Object.entries(bids).filter(([id, amount]) => id !== winnerId && amount > 0).map(([id, amount]) => ({ from: id, to: 'BANK', amount })),
    winnerId,
    bids,
  };
}
