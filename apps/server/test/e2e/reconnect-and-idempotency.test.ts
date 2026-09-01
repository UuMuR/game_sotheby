import { describe, expect, it } from 'vitest';

import { handleCommand, initializeGame, loadPlaceholderCatalog, type GameState } from '@sotheby/game-engine';

import { CommandService, InMemoryGameSessionStore } from '../../src/games/command-service.ts';
import { InMemoryConnectionRegistry, type SocketConnection } from '../../src/games/connection-registry.ts';
import { InMemoryRoomLock } from '../../src/games/room-lock.ts';

function socket(): SocketConnection & { closed: boolean; messages: string[] } {
  return { readyState: 1, closed: false, messages: [], send(data) { this.messages.push(data); }, close() { this.closed = true; this.readyState = 3; } };
}

function game(): GameState {
  const catalog = loadPlaceholderCatalog();
  const open = catalog.find((card) => card.auctionType === 'OPEN' && !card.stolen)!;
  const initial = initializeGame({ roomId: 'r1', gameId: 'g1', catalog, randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] }, players: ['p1','p2','p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })) });
  return { ...initial, hostPlayerId: 'p1', players: { ...initial.players, p1: { ...initial.players.p1!, hand: [open] } } };
}

describe('reconnect and command idempotency', () => {
  it('replaces the connection and does not apply an accepted request twice', async () => {
    const registry = new InMemoryConnectionRegistry();
    const oldSocket = socket();
    const newSocket = socket();
    registry.add('g1', 'p2', oldSocket);
    registry.add('g1', 'p2', newSocket);
    expect(oldSocket.closed).toBe(true);

    const games = new InMemoryGameSessionStore();
    const initial = game();
    const played = handleCommand(initial, { requestId: 'play', playerId: 'p1', stateVersion: initial.stateVersion, type: 'PLAY_CARD', payload: { cardId: initial.players.p1!.hand[0]!.id } }, new Date('2026-09-01T08:00:00.000Z'));
    if (!played.ok) throw new Error(played.error.code);
    games.seed(played.state);
    const service = new CommandService({ gameStore: games, roomLock: new InMemoryRoomLock(), connections: registry });
    const bidEnvelope = { type: 'COMMAND' as const, requestId: 'bid-once', roomId: 'r1', gameId: 'g1', playerId: 'p2', stateVersion: played.state.stateVersion, command: { type: 'PLACE_OPEN_BID' as const, payload: { amount: 20 } } };

    const first = await service.execute(bidEnvelope, new Date('2026-09-01T08:00:01.000Z'));
    const repeated = await service.execute(bidEnvelope, new Date('2026-09-01T08:00:02.000Z'));

    expect(repeated).toEqual(first);
    expect(games.get('g1')?.eventSequence).toBe(2);
    expect(newSocket.messages.length).toBe(1);
  });
});
