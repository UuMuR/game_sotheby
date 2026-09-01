import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import type { WechatIdentityClient } from '../src/auth/wechat-client.ts';
import { InMemoryLobbyStore } from '../src/rooms/room-service.ts';
import { InMemoryResultStore } from '../src/results/result-service.ts';

const wechatClient: WechatIdentityClient = { async exchangeCode(code) { return { openId: `openid-${code}` }; } };

async function login(app: ReturnType<typeof buildApp>, code: string) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code } });
  return response.json<{ token: string; player: { id: string } }>();
}

describe('result APIs', () => {
  it('returns only the requesting player private settlement ledger', async () => {
    const results = new InMemoryResultStore();
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '123456', resultStore: results });
    const alice = await login(app, 'alice');
    const bob = await login(app, 'bob');
    results.save({
      gameId: 'game-1', roomCode: '123456', finishedAt: '2026-09-01T10:00:00.000Z', playerIds: [alice.player.id, bob.player.id],
      finalStandings: [{ playerId: alice.player.id, nickname: 'Alice', cash: 20, place: 1, winner: true }, { playerId: bob.player.id, nickname: 'Bob', cash: 10, place: 2, winner: false }],
      publicRoundSummaries: [], privateLedgers: { [alice.player.id]: [{ reason: 'COLLECTION_SALE', delta: 30 }], [bob.player.id]: [{ reason: 'STOLEN_FINE', delta: -20 }] },
    });
    const response = await app.inject({ method: 'GET', url: '/v1/games/game-1/result', headers: { authorization: `Bearer ${alice.token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ privateLedger: [{ reason: 'COLLECTION_SALE', delta: 30 }] });
    expect(JSON.stringify(response.json())).not.toContain('STOLEN_FINE');
    await app.close();
  });

  it('lists only the requesting player game history and preserves anonymized opponents', async () => {
    const results = new InMemoryResultStore();
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '123456', resultStore: results });
    const alice = await login(app, 'alice');
    const bob = await login(app, 'bob');
    results.save({ gameId: 'game-a', roomCode: '111111', finishedAt: '2026-09-01T10:00:00.000Z', playerIds: [alice.player.id], finalStandings: [{ playerId: alice.player.id, nickname: 'Alice', cash: 50, place: 1, winner: true }], publicRoundSummaries: [], privateLedgers: {} });
    results.save({ gameId: 'game-b', roomCode: '222222', finishedAt: '2026-09-01T11:00:00.000Z', playerIds: [bob.player.id], finalStandings: [{ playerId: bob.player.id, nickname: '已注销玩家', cash: -5, place: 1, winner: true }], publicRoundSummaries: [], privateLedgers: {} });
    const response = await app.inject({ method: 'GET', url: '/v1/me/game-history', headers: { authorization: `Bearer ${alice.token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json<Array<{ gameId: string }>>().map((row) => row.gameId)).toEqual(['game-a']);
    await app.close();
  });
});

describe('automatic result capture', () => {
  it('stores a finished game result after the final advance command', async () => {
    const results = new InMemoryResultStore();
    const { CommandService, InMemoryGameSessionStore } = await import('../src/games/command-service.ts');
    const { InMemoryConnectionRegistry } = await import('../src/games/connection-registry.ts');
    const { InMemoryRoomLock } = await import('../src/games/room-lock.ts');
    const { initializeGame, loadPlaceholderCatalog } = await import('@sotheby/game-engine');
    const state = initializeGame({
      roomId: 'room-finish', gameId: 'game-finish', catalog: loadPlaceholderCatalog(),
      randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] },
      players: ['p1','p2','p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
    });
    const games = new InMemoryGameSessionStore();
    games.seed({ ...state, round: 4, status: 'ROUND_SETTLEMENT', lastRoundSettlement: { round: 4, rankings: [], ledger: [] } });
    const service = new CommandService({ gameStore: games, roomLock: new InMemoryRoomLock(), connections: new InMemoryConnectionRegistry(), resultStore: results, roomCodeFor: () => '999999' });

    const response = await service.execute({ type: 'COMMAND', requestId: 'finish-once', roomId: 'room-finish', gameId: 'game-finish', playerId: 'p1', stateVersion: 1, command: { type: 'ADVANCE_AFTER_SETTLEMENT', payload: {} } }, new Date('2026-09-01T12:00:00.000Z'));

    expect(response.type).toBe('COMMAND_ACCEPTED');
    expect(results.get('game-finish')?.finalStandings).toHaveLength(3);
    expect(results.get('game-finish')?.roomCode).toBe('999999');
  });
});

describe('room lifecycle after final result', () => {
  it('invokes the finish hook once when the final round advances', async () => {
    const results = new InMemoryResultStore();
    const { CommandService, InMemoryGameSessionStore } = await import('../src/games/command-service.ts');
    const { InMemoryConnectionRegistry } = await import('../src/games/connection-registry.ts');
    const { InMemoryRoomLock } = await import('../src/games/room-lock.ts');
    const { initializeGame, loadPlaceholderCatalog } = await import('@sotheby/game-engine');
    const state = initializeGame({
      roomId: 'room-finish-hook', gameId: 'game-finish-hook', catalog: loadPlaceholderCatalog(),
      randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] },
      players: ['p1','p2','p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
    });
    const games = new InMemoryGameSessionStore();
    games.seed({ ...state, round: 4, status: 'ROUND_SETTLEMENT', lastRoundSettlement: { round: 4, rankings: [], ledger: [] } });
    const finishedRooms: string[] = [];
    const service = new CommandService({
      gameStore: games,
      roomLock: new InMemoryRoomLock(),
      connections: new InMemoryConnectionRegistry(),
      resultStore: results,
      roomCodeFor: () => '999998',
      onGameFinished: (finished) => { finishedRooms.push(finished.roomId); },
    });
    const envelope = { type: 'COMMAND' as const, requestId: 'finish-hook', roomId: state.roomId, gameId: state.gameId, playerId: 'p1', stateVersion: 1, command: { type: 'ADVANCE_AFTER_SETTLEMENT' as const, payload: {} } };

    await service.execute(envelope, new Date('2026-09-01T12:00:00.000Z'));
    await service.execute(envelope, new Date('2026-09-01T12:00:01.000Z'));

    expect(finishedRooms).toEqual(['room-finish-hook']);
  });
});
