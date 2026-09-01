import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  initializeGame,
  loadPlaceholderCatalog,
  type GameCommandInput,
  type GameState,
} from '@sotheby/game-engine';

import { buildApp } from '../src/app.ts';
import type { WechatIdentityClient } from '../src/auth/wechat-client.ts';
import { InMemoryLobbyStore } from '../src/rooms/room-service.ts';
import { InMemoryConnectionRegistry } from '../src/games/connection-registry.ts';
import { CommandService, InMemoryGameSessionStore } from '../src/games/command-service.ts';
import { InMemoryRoomLock } from '../src/games/room-lock.ts';

const wechatClient: WechatIdentityClient = {
  async exchangeCode(code) { return { openId: `openid-${code}` }; },
};

function createState(): GameState {
  const catalog = loadPlaceholderCatalog();
  const open = catalog.find((card) => card.auctionType === 'OPEN' && !card.stolen)!;
  const state = initializeGame({
    roomId: 'room-1', gameId: 'game-1', catalog,
    randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] },
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
  });
  return {
    ...state,
    hostPlayerId: 'p1',
    players: {
      ...state.players,
      p1: { ...state.players.p1!, hand: [open] },
    },
  };
}

function envelope(state: GameState, playerId: string, requestId: string, command: Omit<GameCommandInput, 'requestId' | 'playerId' | 'stateVersion'>) {
  return { type: 'COMMAND' as const, requestId, roomId: state.roomId, gameId: state.gameId, playerId, stateVersion: state.stateVersion, command };
}

async function nextJson(socket: WebSocket): Promise<Record<string, unknown>> {
  const [data] = await once(socket, 'message');
  return JSON.parse(data.toString()) as Record<string, unknown>;
}

const servers: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('game websocket', () => {
  it('authenticates connections and sends personalized initial state', async () => {
    const lobbyStore = new InMemoryLobbyStore();
    const gameStore = new InMemoryGameSessionStore();
    gameStore.seed(createState());
    const app = buildApp({ wechatClient, store: lobbyStore, randomCode: () => '123456', gameRuntime: { gameStore } });
    servers.push(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    const aliceAuth = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code: 'alice' } });
    const bobAuth = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code: 'bob' } });
    const alice = aliceAuth.json<{ token: string; player: { id: string } }>();
    const bob = bobAuth.json<{ token: string; player: { id: string } }>();
    const seedState = createState();
    const aliceState = seedState.players.p1!;
    const bobState = seedState.players.p2!;
    const observerState = seedState.players.p3!;
    gameStore.seed({
      ...seedState,
      players: {
        [alice.player.id]: { ...aliceState, id: alice.player.id, nickname: 'Alice' },
        [bob.player.id]: { ...bobState, id: bob.player.id, nickname: 'Bob' },
        p3: observerState,
      },
      seatOrder: [alice.player.id, bob.player.id, 'p3'],
      hostPlayerId: alice.player.id,
    });

    const aliceSocket = new WebSocket(`${address.replace('http', 'ws')}/v1/games/game-1/socket?token=${alice.token}`);
    const bobSocket = new WebSocket(`${address.replace('http', 'ws')}/v1/games/game-1/socket?token=${bob.token}`);
    const [aliceMessage, bobMessage] = await Promise.all([nextJson(aliceSocket), nextJson(bobSocket)]);

    expect(aliceMessage.type).toBe('STATE');
    expect(bobMessage.type).toBe('STATE');
    expect(JSON.stringify(aliceMessage)).not.toContain(bobState.hand[0]?.id);
    expect(JSON.stringify(bobMessage)).not.toContain(aliceState.hand[0]?.id);
    aliceSocket.close();
    bobSocket.close();
  });
});

describe('serialized game commands', () => {
  it('returns the original result for a duplicate request id', async () => {
    const gameStore = new InMemoryGameSessionStore();
    const state = createState();
    gameStore.seed(state);
    const service = new CommandService({ gameStore, roomLock: new InMemoryRoomLock(), connections: new InMemoryConnectionRegistry() });
    const cardId = state.players.p1?.hand[0]?.id ?? '';
    const input = envelope(state, 'p1', 'same-request', { type: 'PLAY_CARD', payload: { cardId } });

    const first = await service.execute(input, new Date('2026-09-01T08:00:00.000Z'));
    const second = await service.execute(input, new Date('2026-09-01T08:00:01.000Z'));

    expect(second).toEqual(first);
    expect(gameStore.get('game-1')?.eventSequence).toBe(1);
  });

  it('serializes simultaneous bids so only one command can use a state version', async () => {
    const gameStore = new InMemoryGameSessionStore();
    const initial = createState();
    gameStore.seed(initial);
    const service = new CommandService({ gameStore, roomLock: new InMemoryRoomLock(), connections: new InMemoryConnectionRegistry() });
    const cardId = initial.players.p1?.hand[0]?.id ?? '';
    const started = await service.execute(envelope(initial, 'p1', 'play', { type: 'PLAY_CARD', payload: { cardId } }), new Date('2026-09-01T08:00:00.000Z'));
    expect(started.type).toBe('COMMAND_ACCEPTED');
    const active = gameStore.get('game-1')!;

    const [left, right] = await Promise.all([
      service.execute(envelope(active, 'p2', 'bid-left', { type: 'PLACE_OPEN_BID', payload: { amount: 10 } }), new Date('2026-09-01T08:00:01.000Z')),
      service.execute(envelope(active, 'p3', 'bid-right', { type: 'PLACE_OPEN_BID', payload: { amount: 11 } }), new Date('2026-09-01T08:00:01.000Z')),
    ]);

    expect([left.type, right.type].sort()).toEqual(['COMMAND_ACCEPTED', 'COMMAND_REJECTED']);
    expect([left, right].find((result) => result.type === 'COMMAND_REJECTED')).toMatchObject({ error: { code: 'STALE_STATE' } });
    expect(gameStore.get('game-1')?.eventSequence).toBe(2);
  });
});

describe('state synchronization messages', () => {
  it('answers SYNC_STATE without treating it as a game command', async () => {
    const connections = new InMemoryConnectionRegistry();
    const socket = { readyState: 1, messages: [] as string[], send(data: string) { this.messages.push(data); }, close() { this.readyState = 3; } };
    const state = createState();
    const games = new InMemoryGameSessionStore();
    games.seed(state);
    connections.add(state.gameId, 'p2', socket);

    const { sendCurrentState } = await import('../src/games/socket-route.ts');
    sendCurrentState(connections, games, state.gameId, 'p2');

    const message = JSON.parse(socket.messages[0] ?? '{}') as { type?: string; state?: { self?: { id?: string } } };
    expect(message.type).toBe('STATE');
    expect(message.state?.self?.id).toBe('p2');
  });
});
