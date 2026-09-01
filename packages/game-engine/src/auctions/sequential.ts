import type { Money } from '@sotheby/contracts';

import type { CommandError, Deadline } from '../commands.ts';
import type { GameState, SequentialAuctionState } from '../model.ts';
import { nextSequentialActor } from '../turns.ts';
import { settleStandardPurchase, type SettlementResult } from './payment.ts';

const TURN_SECONDS = 30;

function deadline(state: GameState, expiresAt: string): Deadline {
  return {
    id: `${state.gameId}:sequential:${state.stateVersion + 1}`,
    roomId: state.roomId,
    gameId: state.gameId,
    expectedStateVersion: state.stateVersion + 1,
    expiresAt,
    action: 'EXPIRE_AUCTION',
  };
}

export function actSequential(
  state: GameState,
  auction: SequentialAuctionState,
  playerId: string,
  amount: Money | null,
  now: Date,
): { auction: SequentialAuctionState; deadline: Deadline } | SettlementResult | CommandError {
  if (auction.actingPlayerId !== playerId) return { code: 'NOT_YOUR_TURN', message: 'It is not this player\'s turn' };
  if (now.getTime() >= Date.parse(auction.expiresAt)) return { code: 'AUCTION_EXPIRED', message: 'Turn expired' };
  const player = state.players[playerId];
  if (player === undefined) return { code: 'PLAYER_NOT_FOUND', message: 'Player is not seated' };

  let currentPrice = auction.currentPrice;
  let currentBidderId = auction.currentBidderId;
  if (amount !== null) {
    if (player.cash <= 0) return { code: 'PLAYER_NOT_ELIGIBLE', message: 'Player has no available cash' };
    if (!Number.isInteger(amount) || amount < 1) return { code: 'INVALID_AMOUNT', message: 'Bid must be a positive whole unit' };
    if (amount <= currentPrice) return { code: 'INVALID_INCREMENT', message: 'Bid must exceed the current price' };
    if (amount > player.cash) return { code: 'INSUFFICIENT_CASH', message: 'Bid exceeds cash balance' };
    currentPrice = amount;
    currentBidderId = playerId;
  }

  const actedPlayerIds = [...auction.actedPlayerIds, playerId];
  if (playerId === state.hostPlayerId) {
    return settleStandardPurchase(
      state,
      state.hostPlayerId,
      currentBidderId ?? state.hostPlayerId,
      currentBidderId === undefined ? 0 : currentPrice,
      auction.cards,
    );
  }

  const next = nextSequentialActor(state, playerId, actedPlayerIds);
  if (next === null) {
    return settleStandardPurchase(
      state,
      state.hostPlayerId,
      currentBidderId ?? state.hostPlayerId,
      currentBidderId === undefined ? 0 : currentPrice,
      auction.cards,
    );
  }
  const expiresAt = new Date(now.getTime() + TURN_SECONDS * 1000).toISOString();
  return {
    auction: {
      ...auction,
      currentPrice,
      ...(currentBidderId === undefined ? {} : { currentBidderId }),
      actingPlayerId: next,
      actedPlayerIds,
      expiresAt,
    },
    deadline: deadline(state, expiresAt),
  };
}

export function initialSequentialDeadline(state: GameState, expiresAt: string): Deadline {
  return deadline(state, expiresAt);
}
