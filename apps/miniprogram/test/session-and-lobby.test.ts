import { describe, expect, it } from 'vitest';

import { createHomeViewModel } from '../miniprogram/pages/home/view-model.ts';
import { createLobbyViewModel } from '../miniprogram/pages/lobby/view-model.ts';
import { validateProfile } from '../miniprogram/pages/profile/view-model.ts';
import type { RequestOptions } from '../miniprogram/services/http.ts';
import { createSessionService, type MiniProgramPlatform } from '../miniprogram/services/session.ts';

function fakePlatform(overrides: Partial<MiniProgramPlatform> = {}): MiniProgramPlatform {
  const storage = new Map<string, unknown>();
  return {
    async login() { return { code: 'wx-code' }; },
    async request<T>() { return { token: 'token-1', player: { id: 'p1', profileComplete: true } } as T; },
    getStorage<T>(key: string) { return storage.get(key) as T | undefined; },
    setStorage(key: string, value: unknown) { storage.set(key, value); },
    removeStorage(key: string) { storage.delete(key); },
    navigateTo() {},
    redirectTo() {},
    ...overrides,
  };
}

describe('session flow', () => {
  it('routes a first-time player to profile setup', async () => {
    const platform = fakePlatform({
      async request<T>() { return { token: 'token-new', player: { id: 'p1', profileComplete: false } } as T; },
    });
    const session = createSessionService(platform, 'https://api.example.test');

    await session.loginAndRoute();

    expect(session.current()?.token).toBe('token-new');
  });

  it('restores an ongoing game before showing the home page', async () => {
    const redirects: string[] = [];
    const platform = fakePlatform({
      getStorage<T>() { return { token: 'saved-token', playerId: 'p1', profileComplete: true } as T; },
      async request<T>(options: RequestOptions) {
        if (options.url.endsWith('/v1/me/active-game')) return { gameId: 'game-9' } as T;
        throw new Error('unexpected request');
      },
      redirectTo(url) { redirects.push(url); },
    });
    const session = createSessionService(platform, 'https://api.example.test');

    await session.restoreAndRoute();

    expect(redirects).toEqual(['/pages/game/index?gameId=game-9']);
  });
});

describe('profile validation', () => {
  it('accepts 1 to 12 trimmed characters and rejects empty or long nicknames', () => {
    expect(validateProfile({ nickname: ' 收藏家 ', avatarUrl: '' })).toEqual({
      ok: true,
      value: { nickname: '收藏家', avatarUrl: '/assets/avatars/default.png' },
    });
    expect(validateProfile({ nickname: '   ', avatarUrl: '' })).toMatchObject({ ok: false });
    expect(validateProfile({ nickname: '一二三四五六七八九十一二三', avatarUrl: '' })).toMatchObject({ ok: false });
  });
});

describe('home and lobby view models', () => {
  it('validates six-digit room codes and recognizes shared room launches', () => {
    const home = createHomeViewModel({ sharedRoomCode: '382917' });
    expect(home.joinCode).toBe('382917');
    expect(home.canJoin).toBe(true);
    expect(createHomeViewModel({ sharedRoomCode: '12A456' }).canJoin).toBe(false);
  });

  it('shows owner controls only when 3 to 8 players are ready', () => {
    const readyLobby = createLobbyViewModel({
      id: 'room-1', code: '382917', ownerPlayerId: 'p1', status: 'WAITING',
      players: [
        { id: 'p1', nickname: 'P1', avatarUrl: '/1.png', seat: 0, ready: false },
        { id: 'p2', nickname: 'P2', avatarUrl: '/2.png', seat: 1, ready: true },
        { id: 'p3', nickname: 'P3', avatarUrl: '/3.png', seat: 2, ready: true },
      ],
    }, 'p1');
    expect(readyLobby.canStart).toBe(true);
    expect(readyLobby.canToggleReady).toBe(false);
    expect(readyLobby.canKickPlayer('p2')).toBe(true);

    const guestLobby = createLobbyViewModel(readyLobby.room, 'p2');
    expect(guestLobby.canStart).toBe(false);
    expect(guestLobby.canToggleReady).toBe(true);
    expect(guestLobby.canKickPlayer('p3')).toBe(false);
  });
});

describe('room API client', () => {
  it('maps create, join, ready, start, and leave actions to authenticated endpoints', async () => {
    const calls: Array<{ url: string; method?: string; data?: unknown; headers?: Record<string, string> }> = [];
    const platform = fakePlatform({
      async request<T>(options: RequestOptions) {
        calls.push(options);
        return { id: 'room-1', code: '382917', ownerPlayerId: 'p1', status: 'WAITING', players: [] } as T;
      },
    });
    const { createHttpClient } = await import('../miniprogram/services/http.ts');
    const { createRoomClient } = await import('../miniprogram/services/rooms.ts');
    const client = createRoomClient(createHttpClient(platform.request.bind(platform), 'https://api.example.test', () => 'token-1'));

    await client.create();
    await client.join('382917');
    await client.setReady('room-1', true);
    await client.start('room-1');
    await client.leave('room-1', 'p1');

    expect(calls.map(({ url, method }) => [url, method])).toEqual([
      ['https://api.example.test/v1/rooms', 'POST'],
      ['https://api.example.test/v1/rooms/382917/join', 'POST'],
      ['https://api.example.test/v1/rooms/room-1/ready', 'POST'],
      ['https://api.example.test/v1/rooms/room-1/start', 'POST'],
      ['https://api.example.test/v1/rooms/room-1/players/p1', 'DELETE'],
    ]);
    expect(calls.every((call) => call.headers?.authorization === 'Bearer token-1')).toBe(true);
  });
});
