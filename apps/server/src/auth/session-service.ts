import { randomUUID } from 'node:crypto';

export interface PlayerProfile {
  id: string;
  wechatOpenId: string;
  nickname: string;
  avatarUrl: string;
  profileComplete: boolean;
  deleted: boolean;
}

export interface Session {
  token: string;
  playerId: string;
  expiresAt: string;
}

export type MaybePromise<T> = T | Promise<T>;

export interface AuthStore {
  findPlayerByOpenId(openId: string): MaybePromise<PlayerProfile | null>;
  findPlayerById(playerId: string): MaybePromise<PlayerProfile | null>;
  savePlayer(player: PlayerProfile): MaybePromise<void>;
  findSession(token: string): MaybePromise<Session | null>;
  saveSession(session: Session): MaybePromise<void>;
  deleteSessionsForPlayer(playerId: string): MaybePromise<void>;
}

export class InMemoryAuthStore implements AuthStore {
  private readonly playersById = new Map<string, PlayerProfile>();
  private readonly playerIdByOpenId = new Map<string, string>();
  private readonly sessions = new Map<string, Session>();

  findPlayerByOpenId(openId: string): PlayerProfile | null {
    const id = this.playerIdByOpenId.get(openId);
    return id ? structuredClone(this.playersById.get(id) ?? null) : null;
  }

  findPlayerById(playerId: string): PlayerProfile | null {
    return structuredClone(this.playersById.get(playerId) ?? null);
  }

  savePlayer(player: PlayerProfile): void {
    this.playersById.set(player.id, structuredClone(player));
    this.playerIdByOpenId.set(player.wechatOpenId, player.id);
  }

  findSession(token: string): Session | null {
    return structuredClone(this.sessions.get(token) ?? null);
  }

  saveSession(session: Session): void {
    this.sessions.set(session.token, structuredClone(session));
  }

  deleteSessionsForPlayer(playerId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.playerId === playerId) this.sessions.delete(token);
    }
  }
}

export class SessionService {
  constructor(
    private readonly store: AuthStore,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  async login(openId: string): Promise<{ token: string; player: PlayerProfile }> {
    let player = await this.store.findPlayerByOpenId(openId);
    if (!player) {
      player = {
        id: this.idFactory(),
        wechatOpenId: openId,
        nickname: '',
        avatarUrl: '/assets/avatars/default.png',
        profileComplete: false,
        deleted: false,
      };
      await this.store.savePlayer(player);
    }
    const token = this.idFactory();
    const expiresAt = new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await this.store.saveSession({ token, playerId: player.id, expiresAt });
    return { token, player };
  }

  async authenticate(token: string | undefined): Promise<PlayerProfile | null> {
    if (!token) return null;
    const session = await this.store.findSession(token);
    if (!session || Date.parse(session.expiresAt) <= this.now().getTime()) return null;
    const player = await this.store.findPlayerById(session.playerId);
    return player?.deleted ? null : player;
  }

  async deleteAccount(playerId: string): Promise<void> {
    const player = await this.store.findPlayerById(playerId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    await this.store.savePlayer({
      ...player,
      wechatOpenId: `deleted:${player.id}`,
      nickname: '已注销玩家',
      avatarUrl: '/assets/avatars/default.png',
      profileComplete: false,
      deleted: true,
    });
    await this.store.deleteSessionsForPlayer(playerId);
  }

  async updateProfile(playerId: string, nickname: string, avatarUrl: string): Promise<PlayerProfile> {
    const player = await this.store.findPlayerById(playerId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    const trimmed = nickname.trim();
    if (Array.from(trimmed).length < 1 || Array.from(trimmed).length > 12) throw new Error('INVALID_NICKNAME');
    if (/\p{C}/u.test(trimmed)) throw new Error('INVALID_NICKNAME');
    const updated = { ...player, nickname: trimmed, avatarUrl: avatarUrl || '/assets/avatars/default.png', profileComplete: true };
    await this.store.savePlayer(updated);
    return updated;
  }
}
