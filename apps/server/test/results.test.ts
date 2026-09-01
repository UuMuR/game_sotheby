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
