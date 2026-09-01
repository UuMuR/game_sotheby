import type { CardDefinition } from '@sotheby/contracts';

import type { GameState, PlayerState, RoundNumber } from '../model.ts';

const REFILL_COUNTS: Readonly<Record<number, number>> = {
  3: 8,
  4: 5,
  5: 3,
  6: 3,
  7: 2,
  8: 2,
};

export interface RefillResult {
  players: Readonly<Record<string, PlayerState>>;
  deck: readonly CardDefinition[];
}

export function refillForRound(state: GameState, round: RoundNumber): RefillResult {
  if (round !== 2 && round !== 3) {
    return { players: state.players, deck: state.deck };
  }

  const count = REFILL_COUNTS[state.seatOrder.length];
  if (count === undefined) throw new Error('A game requires between 3 and 8 players');
  const required = count * state.seatOrder.length;
  if (state.deck.length < required) throw new Error(`Deck requires ${required} cards for refill`);

  const players = { ...state.players } as Record<string, PlayerState>;
  let cursor = 0;
  for (const playerId of state.seatOrder) {
    const player = players[playerId];
    if (!player) throw new Error(`Seat references missing player ${playerId}`);
    players[playerId] = {
      ...player,
      hand: [...player.hand, ...state.deck.slice(cursor, cursor + count)],
    };
    cursor += count;
  }

  return { players, deck: state.deck.slice(cursor) };
}
