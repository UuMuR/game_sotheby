import { describe, expect, it } from 'vitest';

import { initializeGame, loadPlaceholderCatalog, projectForPlayer } from '@sotheby/game-engine';

import { RedisGameSessionStore } from '../../src/db/redis-game-session-store.ts';
import { MySqlResultStore } from '../../src/db/repositories/mysql-result-store.ts';

class FakeRedis {
  readonly values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async setValue(key: string, value: string) { this.values.set(key, value); }
  async setExpiringValue(key: string, value: string) { if (!this.values.has(key)) this.values.set(key, value); }
}

function game() {
  return initializeGame({
    roomId: 'r1', gameId: 'g1', catalog: loadPlaceholderCatalog(),
    randomSource: { next: () => 0, integer: () => 0, shuffle: (values) => [...values] },
    players: ['p1','p2','p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
  });
}

describe('Redis game session store', () => {
  it('stores game snapshots and idempotent command results as JSON', async () => {
    const redis = new FakeRedis();
    const store = new RedisGameSessionStore(redis);
    const state = game();
    await store.save(state);
    await store.saveCommandResult('request-1', { type: 'COMMAND_ACCEPTED', requestId: 'request-1', state: { gameId: 'g1' } as never, events: [] });

    expect(await store.get('g1')).toEqual(state);
    expect(await store.findCommandResult('request-1')).toMatchObject({ requestId: 'request-1' });
  });
});

describe('MySQL result store', () => {
  it('upserts JSON results and reads history through game_players membership', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const result = { gameId: 'g1', roomCode: '123456', finishedAt: '2026-09-01T12:00:00.000Z', playerIds: ['p1'], finalStandings: [{ playerId: 'p1', nickname: 'P1', cash: 10, place: 1, winner: true }], publicRoundSummaries: [], privateLedgers: {} };
    const pool = {
      async execute(sql: string, params: unknown[]) { calls.push({ sql, params }); return [{ affectedRows: 1 }, []]; },
      async query(sql: string) { calls.push({ sql, params: [] }); return [[{ result: JSON.stringify(result) }], []]; },
    };
    const store = new MySqlResultStore(pool as never);

    await store.save(result);
    expect(await store.get('g1')).toEqual(result);
    expect(await store.listForPlayer('p1')).toEqual([result]);
    expect(calls.some((call) => call.sql.includes('INSERT INTO game_results'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('JOIN game_players'))).toBe(true);
  });
});

describe('persistent game session store', () => {
  it('loads from MySQL on a Redis miss and warms the cache', async () => {
    const redis = new FakeRedis();
    const state = game();
    const repository = {
      async loadGameForRecovery() { return { snapshot: state, eventsAfterSnapshot: [] }; },
      async appendEventsAndSnapshot() { return state; },
    };
    const idempotency = { async findCommandResult() { return null; }, async saveCommandResult() {} };
    const { PersistentGameSessionStore } = await import('../../src/db/persistent-game-session-store.ts');
    const store = new PersistentGameSessionStore(redis, repository, idempotency);

    expect(await store.get('g1')).toEqual(state);
    expect(redis.values.get('game:state:g1')).toBe(JSON.stringify(state));
  });

  it('persists an accepted transition before caching it', async () => {
    const order: string[] = [];
    const redis = new FakeRedis();
    const repository = {
      async loadGameForRecovery() { return { snapshot: null, eventsAfterSnapshot: [] }; },
      async appendEventsAndSnapshot(input: unknown) { order.push('mysql'); return (input as { nextState: ReturnType<typeof game> }).nextState; },
    };
    const idempotency = { async findCommandResult() { return null; }, async saveCommandResult() { order.push('unexpected-idempotency'); } };
    const { PersistentGameSessionStore } = await import('../../src/db/persistent-game-session-store.ts');
    const store = new PersistentGameSessionStore(redis, repository, idempotency, () => order.push('redis'));
    const state = game();

    await store.commit(
      { gameId: state.gameId, expectedStateVersion: 0, nextState: state, events: [], writeSnapshot: true },
      'request-1',
      { type: 'COMMAND_ACCEPTED', requestId: 'request-1', state: projectForPlayer(state, 'p1'), events: [] },
    );

    expect(order).toEqual(['mysql', 'redis']);
  });
});

describe('MySQL lobby and auth store', () => {
  it('persists profiles, sessions, rooms, seats, and initial game snapshots', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const connection = {
      async beginTransaction() { calls.push({ sql: 'BEGIN', params: [] }); },
      async commit() { calls.push({ sql: 'COMMIT', params: [] }); },
      async rollback() {},
      release() {},
      async execute(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return [{ affectedRows: 1 }, []]; },
    };
    const pool = {
      async getConnection() { return connection; },
      async execute(sql: string, params: unknown[] = []) { calls.push({ sql, params }); return [{ affectedRows: 1 }, []]; },
      async query(sql: string) {
        calls.push({ sql, params: [] });
        if (sql.includes('FROM rooms r')) return [[{ id: 'r1', code: '123456', owner_player_id: 'p1', status: 'WAITING', game_id: null, player_id: 'p1', nickname: 'P1', avatar_url: '/1.png', seat: 0, ready: 0 }], []];
        return [[], []];
      },
    };
    const { MySqlLobbyStore } = await import('../../src/db/mysql-lobby-store.ts');
    const store = new MySqlLobbyStore(pool as never, 'test-session-secret-1234');
    const state = game();

    await store.savePlayer({ id: 'p1', wechatOpenId: 'o1', nickname: 'P1', avatarUrl: '/1.png', profileComplete: true, deleted: false });
    await store.saveSession({ token: 'token-1', playerId: 'p1', expiresAt: '2026-10-01T00:00:00.000Z' });
    await store.saveRoom({ id: 'r1', code: '123456', ownerPlayerId: 'p1', status: 'WAITING', players: [{ id: 'p1', nickname: 'P1', avatarUrl: '/1.png', seat: 0, ready: false }] });
    await store.saveGame(state);
    expect(await store.getRoom('r1')).toMatchObject({ id: 'r1', code: '123456' });

    expect(calls.some((call) => call.sql.includes('INSERT INTO players'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO sessions'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO rooms'))).toBe(true);
    expect(calls.some((call) => call.sql.includes('INSERT INTO game_snapshots'))).toBe(true);
  });
});
