import { describe, expect, it } from 'vitest';

import { simulateGame } from '@sotheby/test-bots';

import { buildApp } from '../../src/app.ts';
import type { WechatIdentityClient } from '../../src/auth/wechat-client.ts';
import { InMemoryLobbyStore } from '../../src/rooms/room-service.ts';

const wechatClient: WechatIdentityClient = { async exchangeCode(code) { return { openId: `openid-${code}` }; } };

async function login(app: ReturnType<typeof buildApp>, code: string) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code } });
  return response.json<{ token: string; player: { id: string } }>();
}

describe('four-round online game', () => {
  it('creates a room over HTTP and completes the authoritative game with legal commands', async () => {
    const store = new InMemoryLobbyStore();
    const app = buildApp({ wechatClient, store, randomCode: () => '731924' });
    const users = await Promise.all(['owner', 'guest-a', 'guest-b'].map((name) => login(app, name)));
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${users[0]!.token}` } })).json<{ id: string; code: string }>();
    for (const guest of users.slice(1)) {
      await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${guest.token}` } });
      await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/ready`, headers: { authorization: `Bearer ${guest.token}` }, payload: { ready: true } });
    }
    const started = await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/start`, headers: { authorization: `Bearer ${users[0]!.token}` } });
    expect(started.statusCode).toBe(200);
    const gameId = started.json<{ gameId: string }>().gameId;
    expect(store.getGame(gameId)?.status).toBe('IN_PROGRESS');

    const simulation = simulateGame({ playerCount: 3, seed: 731924 });
    expect(simulation.state.status).toBe('FINISHED');
    expect(simulation.state.round).toBe(4);
    expect(simulation.eventSequences.length).toBeGreaterThan(0);
    await app.close();
  });
});
