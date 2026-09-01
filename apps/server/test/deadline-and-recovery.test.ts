import { describe, expect, it } from 'vitest';

import {
  handleCommand,
  initializeGame,
  loadPlaceholderCatalog,
  type GameCommandInput,
  type GameState,
} from '@sotheby/game-engine';

import { CommandService, InMemoryGameSessionStore } from '../src/games/command-service.ts';
import { InMemoryConnectionRegistry, type SocketConnection } from '../src/games/connection-registry.ts';
import { DeadlineWorker, InMemoryDeadlineStore } from '../src/games/deadline-store.ts';
import { InMemoryRoomLock } from '../src/games/room-lock.ts';
import { RecoveryService } from '../src/games/recovery-service.ts';

function baseState(): GameState {
  const catalog = loadPlaceholderCatalog();
  const open = catalog.find((card) => card.auctionType === 'OPEN' && !card.stolen)!;
  const state = initializeGame({
    roomId: 'room-1', gameId: 'game-1', catalog,
    randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] },
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
  });
  return { ...state, hostPlayerId: 'p1', players: { ...state.players, p1: { ...state.players.p1!, hand: [open] } } };
}

function command(state: GameState, requestId: string, type: 'PLAY_CARD' | 'EXPIRE_AUCTION', payload: { cardId: string } | Record<string, never>): GameCommandInput {
  return { requestId, playerId: 'p1', stateVersion: state.stateVersion, type, payload } as GameCommandInput;
}

describe('deadline store and worker', () => {
  it('claims one due deadline exactly once', async () => {
    const store = new InMemoryDeadlineStore();
    await store.schedule({ id: 'd1', roomId: 'r1', gameId: 'g1', expectedStateVersion: 2, expiresAt: '2026-09-01T08:00:30.000Z', action: 'EXPIRE_AUCTION' });
    expect(await store.claimDue(new Date('2026-09-01T08:00:29.000Z'))).toBeNull();
    expect(await store.claimDue(new Date('2026-09-01T08:00:30.000Z'))).toMatchObject({ id: 'd1' });
    expect(await store.claimDue(new Date('2026-09-01T08:00:31.000Z'))).toBeNull();
  });

  it('makes a repeated timeout harmless through deterministic request ids', async () => {
    const games = new InMemoryGameSessionStore();
    const initial = baseState();
    games.seed(initial);
    const service = new CommandService({ gameStore: games, roomLock: new InMemoryRoomLock(), connections: new InMemoryConnectionRegistry() });
    const played = await service.execute({ type: 'COMMAND', requestId: 'play', roomId: initial.roomId, gameId: initial.gameId, playerId: 'p1', stateVersion: initial.stateVersion, command: { type: 'PLAY_CARD', payload: { cardId: initial.players.p1!.hand[0]!.id } } }, new Date('2026-09-01T08:00:00.000Z'));
    expect(played.type).toBe('COMMAND_ACCEPTED');
    const active = games.get('game-1')!;
    const deadlineStore = new InMemoryDeadlineStore();
    await deadlineStore.schedule({ id: 'auction-expiry', roomId: active.roomId, gameId: active.gameId, expectedStateVersion: active.stateVersion, expiresAt: '2026-09-01T08:00:30.000Z', action: 'EXPIRE_AUCTION' });
    const worker = new DeadlineWorker(deadlineStore, service);

    await worker.runOnce(new Date('2026-09-01T08:00:30.000Z'));
    await deadlineStore.schedule({ id: 'auction-expiry', roomId: active.roomId, gameId: active.gameId, expectedStateVersion: active.stateVersion, expiresAt: '2026-09-01T08:00:30.000Z', action: 'EXPIRE_AUCTION' });
    await worker.runOnce(new Date('2026-09-01T08:00:31.000Z'));

    expect(games.get('game-1')?.eventSequence).toBe(2);
  });
});

describe('recovery and reconnect', () => {
  it('rebuilds a missing cache from the latest snapshot and later events', async () => {
    const snapshot = baseState();
    const advanced = handleCommand(snapshot, command(snapshot, 'play', 'PLAY_CARD', { cardId: snapshot.players.p1!.hand[0]!.id }), new Date('2026-09-01T08:00:00.000Z'));
    if (!advanced.ok) throw new Error(advanced.error.code);
    const source = {
      async listActiveGameIds() { return ['game-1']; },
      async loadGameForRecovery() { return { snapshot, eventsAfterSnapshot: advanced.events }; },
    };
    const cache = new InMemoryGameSessionStore();
    const recovery = new RecoveryService(source, cache);
    await recovery.recoverActiveGames();
    expect(cache.get('game-1')).toEqual(advanced.state);
  });

  it('replaces stale same-account connections and keeps one online identity', () => {
    const registry = new InMemoryConnectionRegistry();
    const first = fakeSocket();
    const second = fakeSocket();
    registry.add('game-1', 'p1', first);
    registry.add('game-1', 'p1', second);
    expect(first.closed).toBe(true);
    expect(registry.connectedPlayerIds('game-1')).toEqual(['p1']);
    registry.send('game-1', 'p1', { type: 'STATE' });
    expect(second.messages).toHaveLength(1);
  });
});

function fakeSocket(): SocketConnection & { messages: string[]; closed: boolean } {
  return {
    readyState: 1,
    messages: [],
    closed: false,
    send(data) { this.messages.push(data); },
    close() { this.closed = true; this.readyState = 3; },
  };
}
