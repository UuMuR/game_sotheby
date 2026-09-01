import type { Money } from '@sotheby/contracts';

import type { PlayerState } from './model.ts';

export interface FinalStanding {
  playerId: string;
  cash: Money;
  place: number;
  winner: boolean;
}

export function rankPlayers(players: readonly PlayerState[]): readonly FinalStanding[] {
  const ordered = [...players].sort((left, right) => right.cash - left.cash || left.seat - right.seat);
  let lastCash: Money | undefined;
  let lastPlace = 0;
  return ordered.map((player, index) => {
    if (player.cash !== lastCash) lastPlace = index + 1;
    lastCash = player.cash;
    return { playerId: player.id, cash: player.cash, place: lastPlace, winner: lastPlace === 1 };
  });
}
