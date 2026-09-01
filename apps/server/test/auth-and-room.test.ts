import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.ts';
import { InMemoryLobbyStore } from '../src/rooms/room-service.ts';
import type { WechatIdentityClient } from '../src/auth/wechat-client.ts';

const wechatClient: WechatIdentityClient = {
  async exchangeCode(code) {
    return { openId: `openid-${code}` };
  },
};

async function login(app: ReturnType<typeof buildApp>, code: string, nickname = code) {
  const response = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code } });
  expect(response.statusCode).toBe(200);
  const session = response.json<{ token: string; player: { id: string } }>();
  await app.inject({
    method: 'POST', url: '/v1/profile', headers: { authorization: `Bearer ${session.token}` },
    payload: { nickname, avatarUrl: '/default.png' },
  });
  return session;
}

describe('wechat login and profile', () => {
  it('reuses one player account for the same OpenID', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '123456' });
    const first = await login(app, 'same');
    const second = await login(app, 'same');
    expect(second.player.id).toBe(first.player.id);
    await app.close();
  });

  it('rejects nicknames outside 1 to 12 trimmed characters', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '123456' });
    const auth = await app.inject({ method: 'POST', url: '/v1/auth/wechat-login', payload: { code: 'alice' } });
    const { token } = auth.json<{ token: string }>();
    const empty = await app.inject({ method: 'POST', url: '/v1/profile', headers: { authorization: `Bearer ${token}` }, payload: { nickname: '   ', avatarUrl: '/a.png' } });
    const long = await app.inject({ method: 'POST', url: '/v1/profile', headers: { authorization: `Bearer ${token}` }, payload: { nickname: '1234567890123', avatarUrl: '/a.png' } });
    expect(empty.statusCode).toBe(400);
    expect(long.statusCode).toBe(400);
    await app.close();
  });
});

describe('friend rooms', () => {
  it('creates a six-digit room and reuses it through join', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '382917' });
    const owner = await login(app, 'owner');
    const guest = await login(app, 'guest');
    const created = await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner.token}` } });
    expect(created.statusCode).toBe(201);
    const room = created.json<{ id: string; code: string; players: unknown[] }>();
    expect(room.code).toMatch(/^\d{6}$/);
    const joined = await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${guest.token}` } });
    expect(joined.statusCode).toBe(200);
    expect(joined.json<{ players: unknown[] }>().players).toHaveLength(2);
    await app.close();
  });

  it('requires 3 to 8 players and every non-owner ready before start', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '111111' });
    const owner = await login(app, 'owner');
    const p2 = await login(app, 'p2');
    const p3 = await login(app, 'p3');
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner.token}` } })).json<{ id: string; code: string }>();
    await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${p2.token}` } });
    await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${p3.token}` } });
    const tooEarly = await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/start`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(tooEarly.statusCode).toBe(409);
    for (const session of [p2, p3]) {
      const ready = await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/ready`, headers: { authorization: `Bearer ${session.token}` }, payload: { ready: true } });
      expect(ready.statusCode).toBe(200);
    }
    const started = await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/start`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(started.statusCode).toBe(200);
    expect(started.json<{ status: string; gameId: string }>().status).toBe('IN_GAME');
    const late = await login(app, 'late');
    const rejected = await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${late.token}` } });
    expect(rejected.statusCode).toBe(409);
    await app.close();
  });

  it('lets the owner remove a guest and transfers ownership clockwise when leaving', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '222222' });
    const owner = await login(app, 'owner');
    const p2 = await login(app, 'p2');
    const p3 = await login(app, 'p3');
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner.token}` } })).json<{ id: string; code: string }>();
    await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${p2.token}` } });
    await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${p3.token}` } });

    const kicked = await app.inject({ method: 'DELETE', url: `/v1/rooms/${room.id}/players/${p3.player.id}`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(kicked.statusCode).toBe(200);
    expect(kicked.json<{ players: Array<{ id: string }> }>().players.map((p) => p.id)).not.toContain(p3.player.id);

    const left = await app.inject({ method: 'DELETE', url: `/v1/rooms/${room.id}/players/${owner.player.id}`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(left.statusCode).toBe(200);
    expect(left.json<{ ownerPlayerId: string }>().ownerPlayerId).toBe(p2.player.id);
    await app.close();
  });
});

describe('room and account boundaries', () => {
  it('rejects a ninth player', async () => {
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => '333333' });
    const sessions = [];
    for (let index = 1; index <= 9; index += 1) sessions.push(await login(app, `capacity-${index}`));
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${sessions[0]!.token}` } })).json<{ code: string }>();
    for (const session of sessions.slice(1, 8)) {
      const joined = await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${session.token}` } });
      expect(joined.statusCode).toBe(200);
    }
    const full = await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${sessions[8]!.token}` } });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: 'ROOM_FULL' });
    await app.close();
  });

  it('prevents one player from occupying two active rooms', async () => {
    const codes = ['444444', '555555'];
    const app = buildApp({ wechatClient, store: new InMemoryLobbyStore(), randomCode: () => codes.shift()! });
    const owner1 = await login(app, 'owner-a');
    const owner2 = await login(app, 'owner-b');
    const guest = await login(app, 'shared-guest');
    const first = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner1.token}` } })).json<{ code: string }>();
    const second = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner2.token}` } })).json<{ code: string }>();
    await app.inject({ method: 'POST', url: `/v1/rooms/${first.code}/join`, headers: { authorization: `Bearer ${guest.token}` } });
    const duplicate = await app.inject({ method: 'POST', url: `/v1/rooms/${second.code}/join`, headers: { authorization: `Bearer ${guest.token}` } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'PLAYER_ALREADY_IN_ROOM' });
    await app.close();
  });

  it('anonymizes a deleted profile and invalidates its sessions', async () => {
    const store = new InMemoryLobbyStore();
    const app = buildApp({ wechatClient, store, randomCode: () => '666666' });
    const session = await login(app, 'delete-me', '待删除玩家');
    const response = await app.inject({ method: 'DELETE', url: '/v1/account', headers: { authorization: `Bearer ${session.token}` } });
    expect(response.statusCode).toBe(204);
    expect(store.findPlayerById(session.player.id)).toMatchObject({ deleted: true, nickname: '已注销玩家', avatarUrl: '/assets/avatars/default.png' });
    const unauthorized = await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${session.token}` } });
    expect(unauthorized.statusCode).toBe(401);
    await app.close();
  });
});

describe('active game recovery endpoint', () => {
  it('returns the started game id for a seated player', async () => {
    const store = new InMemoryLobbyStore();
    const codes = ['777777'];
    const app = buildApp({ wechatClient, store, randomCode: () => codes.shift()! });
    const owner = await login(app, 'resume-owner');
    const p2 = await login(app, 'resume-p2');
    const p3 = await login(app, 'resume-p3');
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner.token}` } })).json<{ id: string; code: string }>();
    for (const guest of [p2, p3]) {
      await app.inject({ method: 'POST', url: `/v1/rooms/${room.code}/join`, headers: { authorization: `Bearer ${guest.token}` } });
      await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/ready`, headers: { authorization: `Bearer ${guest.token}` }, payload: { ready: true } });
    }
    const started = await app.inject({ method: 'POST', url: `/v1/rooms/${room.id}/start`, headers: { authorization: `Bearer ${owner.token}` } });
    const gameId = started.json<{ gameId: string }>().gameId;

    const active = await app.inject({ method: 'GET', url: '/v1/me/active-game', headers: { authorization: `Bearer ${p2.token}` } });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toEqual({ gameId });
    expect(store.getGame(gameId)).not.toBeNull();
    await app.close();
  });
});

describe('room detail endpoint', () => {
  it('returns the room to a seated player and rejects outsiders', async () => {
    const store = new InMemoryLobbyStore();
    const app = buildApp({ wechatClient, store, randomCode: () => '888888' });
    const owner = await login(app, 'detail-owner');
    const outsider = await login(app, 'detail-outsider');
    const room = (await app.inject({ method: 'POST', url: '/v1/rooms', headers: { authorization: `Bearer ${owner.token}` } })).json<{ id: string; code: string }>();

    const allowed = await app.inject({ method: 'GET', url: `/v1/rooms/${room.id}`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({ id: room.id, code: '888888' });

    const denied = await app.inject({ method: 'GET', url: `/v1/rooms/${room.id}`, headers: { authorization: `Bearer ${outsider.token}` } });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });
});
