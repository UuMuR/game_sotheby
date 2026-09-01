import type { GameState } from './model.ts';

export function nextSeatPlayerId(state: GameState, playerId: string): string {
  const currentIndex = state.seatOrder.indexOf(playerId);
  if (currentIndex < 0) {
    throw new Error(`Player ${playerId} is not part of game ${state.gameId}`);
  }

  const next = state.seatOrder[(currentIndex + 1) % state.seatOrder.length];
  if (next === undefined) {
    throw new Error(`Game ${state.gameId} has no seated players`);
  }
  return next;
}
