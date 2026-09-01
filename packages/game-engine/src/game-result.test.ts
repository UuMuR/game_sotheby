import { describe, expect, it } from 'vitest';

import { rankPlayers } from './game-result.ts';

const player = (id: string, cash: number, seat: number) => ({
  id,
  nickname: id,
  avatarUrl: `/${id}.png`,
  seat,
  online: true,
  cash,
  hand: [],
  purchasedCards: [],
});

describe('rankPlayers', () => {
  it('ranks only by net cash and keeps ties as multiple winners', () => {
    const standings = rankPlayers([
      player('alice', 30, 0),
      player('bob', -10, 1),
      player('carol', 30, 2),
      player('dave', 0, 3),
    ]);

    expect(standings).toEqual([
      { playerId: 'alice', cash: 30, place: 1, winner: true },
      { playerId: 'carol', cash: 30, place: 1, winner: true },
      { playerId: 'dave', cash: 0, place: 3, winner: false },
      { playerId: 'bob', cash: -10, place: 4, winner: false },
    ]);
  });
});
