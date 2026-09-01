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

export interface AuthStore {
  findPlayerByOpenId(openId: string): PlayerProfile | null;
  findPlayerById(playerId: string): PlayerProfile | null;
  savePlayer(player: PlayerProfile): void;
  findSession(token: string): Session | null;
  saveSession(session: Session): void;
  deleteSessionsForPlayer(playerId: string): void;
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

  login(openId: string): { token: string; player: PlayerProfile } {
    let player = this.store.findPlayerByOpenId(openId);
    if (!player) {
      player = {
        id: this.idFactory(),
        wechatOpenId: openId,
        nickname: '',
        avatarUrl: '/assets/avatars/default.png',
        profileComplete: false,
        deleted: false,
      };
      this.store.savePlayer(player);
    }
    const token = this.idFactory();
    const expiresAt = new Date(this.now().getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    this.store.saveSession({ token, playerId: player.id, expiresAt });
    return { token, player };
  }

  authenticate(token: string | undefined): PlayerProfile | null {
    if (!token) return null;
    const session = this.store.findSession(token);
    if (!session || Date.parse(session.expiresAt) <= this.now().getTime()) return null;
    const player = this.store.findPlayerById(session.playerId);
    return player?.deleted ? null : player;
  }

  deleteAccount(playerId: string): void {
    const player = this.store.findPlayerById(playerId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    this.store.savePlayer({
      ...player,
      wechatOpenId: `deleted:${player.id}`,
      nickname: '已注销玩家',
      avatarUrl: '/assets/avatars/default.png',
      profileComplete: false,
      deleted: true,
    });
    this.store.deleteSessionsForPlayer(playerId);
  }

  updateProfile(playerId: string, nickname: string, avatarUrl: string): PlayerProfile {
    const player = this.store.findPlayerById(playerId);
    if (!player) throw new Error('PLAYER_NOT_FOUND');
    const trimmed = nickname.trim();
    if (Array.from(trimmed).length < 1 || Array.from(trimmed).length > 12) throw new Error('INVALID_NICKNAME');
    if (/\p{C}/u.test(trimmed)) throw new Error('INVALID_NICKNAME');
    const updated = { ...player, nickname: trimmed, avatarUrl: avatarUrl || '/assets/avatars/default.png', profileComplete: true };
    this.store.savePlayer(updated);
    return updated;
  }
}
