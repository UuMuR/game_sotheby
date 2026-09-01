import { describe, expect, it } from 'vitest';

import { loadPlaceholderCatalog } from './catalog.ts';
import { initializeGame } from './initialize.ts';
import { createSeededRandom } from './random.ts';
import { nextSeatPlayerId } from './turns.ts';

function players(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    nickname: `玩家${index + 1}`,
    avatarUrl: `/avatars/${index + 1}.png`,
  }));
}

describe.each([
  [3, 11],
  [4, 10],
  [6, 8],
  [8, 6],
] as const)('initializeGame with %i players', (playerCount, expectedHandSize) => {
  it(`deals ${expectedHandSize} unique cards to each player`, () => {
    const state = initializeGame({
      roomId: 'room-1',
      gameId: 'game-1',
      players: players(playerCount),
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(20260901),
    });

    expect(Object.values(state.players)).toHaveLength(playerCount);
    expect(Object.values(state.players).every((player) => player.cash === 150)).toBe(true);
    expect(
      Object.values(state.players).every((player) => player.hand.length === expectedHandSize),
    ).toBe(true);

    const dealtIds = Object.values(state.players).flatMap((player) =>
      player.hand.map((card) => card.id),
    );
    expect(new Set(dealtIds).size).toBe(dealtIds.length);
    expect(state.deck).toHaveLength(84 - playerCount * expectedHandSize);
    expect(state.round).toBe(1);
    expect(state.stateVersion).toBe(1);
    expect(state.eventSequence).toBe(0);
    expect(state.auction).toBeNull();
    expect(state.hostPlayerId in state.players).toBe(true);
    expect(Object.values(state.players).every((player) => player.purchasedCards.length === 0)).toBe(
      true,
    );
  });
});

describe('initializeGame validation and deterministic randomness', () => {
  it('rejects player counts outside 3 to 8', () => {
    const input = {
      roomId: 'room-1',
      gameId: 'game-1',
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(1),
    };

    expect(() => initializeGame({ ...input, players: players(2) })).toThrow(/3.*8/);
    expect(() => initializeGame({ ...input, players: players(9) })).toThrow(/3.*8/);
  });

  it('produces the same deal and host for the same seed', () => {
    const create = () =>
      initializeGame({
        roomId: 'room-1',
        gameId: 'game-1',
        players: players(5),
        catalog: loadPlaceholderCatalog(),
        randomSource: createSeededRandom(42),
      });

    expect(create()).toEqual(create());
  });
});

describe('nextSeatPlayerId', () => {
  it('moves clockwise and wraps to the first seat', () => {
    const state = initializeGame({
      roomId: 'room-1',
      gameId: 'game-1',
      players: players(3),
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(7),
    });

    expect(nextSeatPlayerId(state, 'player-1')).toBe('player-2');
    expect(nextSeatPlayerId(state, 'player-3')).toBe('player-1');
  });
});
