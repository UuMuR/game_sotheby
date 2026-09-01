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

export function nextEligibleBuyerAfter(
  state: GameState,
  playerId: string,
  stopBeforePlayerId: string | null,
): string | null {
  const startIndex = state.seatOrder.indexOf(playerId);
  if (startIndex < 0) throw new Error(`Player ${playerId} is not part of game ${state.gameId}`);
  for (let offset = 1; offset <= state.seatOrder.length; offset += 1) {
    const candidateId = state.seatOrder[(startIndex + offset) % state.seatOrder.length];
    if (candidateId === undefined || candidateId === stopBeforePlayerId) return null;
    const candidate = state.players[candidateId];
    if (candidate !== undefined && candidate.cash > 0) return candidateId;
  }
  return null;
}

export function nextSequentialActor(
  state: GameState,
  playerId: string,
  actedPlayerIds: readonly string[],
): string | null {
  let candidateId = nextSeatPlayerId(state, playerId);
  for (let count = 0; count < state.seatOrder.length; count += 1) {
    if (!actedPlayerIds.includes(candidateId)) return candidateId;
    candidateId = nextSeatPlayerId(state, candidateId);
  }
  return null;
}
