import { describe, expect, it } from 'vitest';

import { loadPlaceholderCatalog } from './catalog.ts';
import { initializeGame } from './initialize.ts';
import { projectForPlayer } from './projection.ts';
import { createSeededRandom } from './random.ts';

const playerInputs = [
  { id: 'alice', nickname: 'Alice', avatarUrl: '/alice.png' },
  { id: 'bob', nickname: 'Bob', avatarUrl: '/bob.png' },
  { id: 'carol', nickname: 'Carol', avatarUrl: '/carol.png' },
];

describe('projectForPlayer', () => {
  it('exposes the requesting player cash and hand', () => {
    const state = initializeGame({
      roomId: 'room-1',
      gameId: 'game-1',
      players: playerInputs,
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(9),
    });

    const view = projectForPlayer(state, 'alice');

    expect(view.self.id).toBe('alice');
    expect(view.self.cash).toBe(150);
    expect(view.self.hand).toEqual(state.players.alice?.hand);
  });

  it('does not expose another player cash or private hand', () => {
    const state = initializeGame({
      roomId: 'room-1',
      gameId: 'game-1',
      players: playerInputs,
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(9),
    });

    const view = projectForPlayer(state, 'alice');
    const bob = view.players.find((player) => player.id === 'bob');
    const bobPrivateCardId = state.players.bob?.hand[0]?.id;

    expect(bob).toBeDefined();
    expect(bob).not.toHaveProperty('cash');
    expect(bob).not.toHaveProperty('hand');
    expect(bob?.handCount).toBe(11);
    expect(JSON.stringify(view)).not.toContain(bobPrivateCardId);
  });

  it('rejects projection for a player outside the game', () => {
    const state = initializeGame({
      roomId: 'room-1',
      gameId: 'game-1',
      players: playerInputs,
      catalog: loadPlaceholderCatalog(),
      randomSource: createSeededRandom(9),
    });

    expect(() => projectForPlayer(state, 'mallory')).toThrow(/not part of game/i);
  });
});
