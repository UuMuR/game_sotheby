import { randomUUID } from 'node:crypto';

import { initializeGame, loadPlaceholderCatalog, type GameState } from '@sotheby/game-engine';

import type { AuthStore, PlayerProfile, Session } from '../auth/session-service.ts';

export type RoomStatus = 'WAITING' | 'IN_GAME' | 'FINISHED' | 'DISBANDED';

export interface RoomPlayer {
  id: string;
  nickname: string;
  avatarUrl: string;
  seat: number;
  ready: boolean;
}

export interface Room {
  id: string;
  code: string;
  ownerPlayerId: string;
  status: RoomStatus;
  players: readonly RoomPlayer[];
  gameId?: string;
}

export interface LobbyStore {
  getRoom(roomId: string): Room | null;
  getRoomByCode(code: string): Room | null;
  saveRoom(room: Room): void;
  deleteRoom(roomId: string): void;
  findActiveRoomByPlayer(playerId: string): Room | null;
  saveGame(game: GameState): void;
  getGame(gameId: string): GameState | null;
}

export class InMemoryLobbyStore implements LobbyStore, AuthStore {
  private readonly authPlayersById = new Map<string, PlayerProfile>();
  private readonly authPlayerIdByOpenId = new Map<string, string>();
  private readonly authSessions = new Map<string, Session>();
  private readonly rooms = new Map<string, Room>();
  private readonly games = new Map<string, GameState>();


  findPlayerByOpenId(openId: string): PlayerProfile | null {
    const id = this.authPlayerIdByOpenId.get(openId);
    return id ? structuredClone(this.authPlayersById.get(id) ?? null) : null;
  }
  findPlayerById(playerId: string): PlayerProfile | null { return structuredClone(this.authPlayersById.get(playerId) ?? null); }
  savePlayer(player: PlayerProfile): void {
    this.authPlayersById.set(player.id, structuredClone(player));
    this.authPlayerIdByOpenId.set(player.wechatOpenId, player.id);
  }
  findSession(token: string): Session | null { return structuredClone(this.authSessions.get(token) ?? null); }
  saveSession(session: Session): void { this.authSessions.set(session.token, structuredClone(session)); }
  deleteSessionsForPlayer(playerId: string): void {
    for (const [token, session] of this.authSessions) {
      if (session.playerId === playerId) this.authSessions.delete(token);
    }
  }

  getRoom(roomId: string): Room | null { return structuredClone(this.rooms.get(roomId) ?? null); }
  getRoomByCode(code: string): Room | null { return [...this.rooms.values()].find((room) => room.code === code) ? structuredClone([...this.rooms.values()].find((room) => room.code === code)!) : null; }
  saveRoom(room: Room): void { this.rooms.set(room.id, structuredClone(room)); }
  deleteRoom(roomId: string): void { this.rooms.delete(roomId); }
  findActiveRoomByPlayer(playerId: string): Room | null {
    const room = [...this.rooms.values()].find((candidate) => candidate.status !== 'FINISHED' && candidate.status !== 'DISBANDED' && candidate.players.some((player) => player.id === playerId));
    return room ? structuredClone(room) : null;
  }
  saveGame(game: GameState): void { this.games.set(game.gameId, structuredClone(game)); }
  getGame(gameId: string): GameState | null { return structuredClone(this.games.get(gameId) ?? null); }
}

export class RoomService {
  constructor(
    private readonly store: LobbyStore,
    private readonly randomCode: () => string,
    private readonly idFactory: () => string = randomUUID,
  ) {}

  findActiveRoom(playerId: string): Room | null {
    return this.store.findActiveRoomByPlayer(playerId);
  }

  create(owner: PlayerProfile): Room {
    this.assertNotInActiveRoom(owner.id);
    let code = this.randomCode();
    for (let attempt = 0; attempt < 20 && this.store.getRoomByCode(code); attempt += 1) code = this.randomCode();
    if (this.store.getRoomByCode(code)) throw new Error('ROOM_CODE_EXHAUSTED');
    if (!/^\d{6}$/.test(code)) throw new Error('INVALID_ROOM_CODE');
    const room: Room = { id: this.idFactory(), code, ownerPlayerId: owner.id, status: 'WAITING', players: [this.toRoomPlayer(owner, 0)] };
    this.store.saveRoom(room);
    return room;
  }

  join(code: string, player: PlayerProfile): Room {
    const existing = this.store.getRoomByCode(code);
    if (!existing) throw new Error('ROOM_NOT_FOUND');
    if (existing.status !== 'WAITING') throw new Error('GAME_ALREADY_STARTED');
    if (existing.players.some((item) => item.id === player.id)) return existing;
    this.assertNotInActiveRoom(player.id);
    if (existing.players.length >= 8) throw new Error('ROOM_FULL');
    const room = { ...existing, players: [...existing.players, this.toRoomPlayer(player, existing.players.length)] };
    this.store.saveRoom(room);
    return room;
  }

  setReady(roomId: string, playerId: string, ready: boolean): Room {
    const room = this.requireWaitingRoom(roomId);
    if (room.ownerPlayerId === playerId) throw new Error('OWNER_DOES_NOT_READY');
    if (!room.players.some((player) => player.id === playerId)) throw new Error('PLAYER_NOT_IN_ROOM');
    const updated = { ...room, players: room.players.map((player) => player.id === playerId ? { ...player, ready } : player) };
    this.store.saveRoom(updated);
    return updated;
  }

  removePlayer(roomId: string, actorPlayerId: string, targetPlayerId: string): Room | null {
    const room = this.requireWaitingRoom(roomId);
    const target = room.players.find((player) => player.id === targetPlayerId);
    if (!target) throw new Error('PLAYER_NOT_IN_ROOM');
    if (actorPlayerId !== targetPlayerId && actorPlayerId !== room.ownerPlayerId) throw new Error('NOT_ROOM_OWNER');
    const remaining = room.players.filter((player) => player.id !== targetPlayerId).map((player, seat) => ({ ...player, seat }));
    if (remaining.length === 0) { this.store.deleteRoom(roomId); return null; }
    const ownerPlayerId = targetPlayerId === room.ownerPlayerId ? remaining[0]!.id : room.ownerPlayerId;
    const updated = { ...room, ownerPlayerId, players: remaining };
    this.store.saveRoom(updated);
    return updated;
  }

  start(roomId: string, actorPlayerId: string): Room {
    const room = this.requireWaitingRoom(roomId);
    if (room.ownerPlayerId !== actorPlayerId) throw new Error('NOT_ROOM_OWNER');
    if (room.players.length < 3 || room.players.length > 8) throw new Error('INVALID_PLAYER_COUNT');
    if (room.players.some((player) => player.id !== room.ownerPlayerId && !player.ready)) throw new Error('PLAYERS_NOT_READY');
    const gameId = this.idFactory();
    const game = initializeGame({
      roomId: room.id,
      gameId,
      players: room.players.map(({ id, nickname, avatarUrl }) => ({ id, nickname, avatarUrl })),
      catalog: loadPlaceholderCatalog(),
      randomSource: {
        next: Math.random,
        integer(maxExclusive) { return Math.floor(this.next() * maxExclusive); },
        shuffle<T>(values: readonly T[]): T[] {
          const copy = [...values];
          for (let i = copy.length - 1; i > 0; i -= 1) {
            const j = Math.floor(this.next() * (i + 1));
            [copy[i], copy[j]] = [copy[j]!, copy[i]!];
          }
          return copy;
        },
      },
    });
    const started: Room = { ...room, status: 'IN_GAME', gameId };
    this.store.saveGame(game);
    this.store.saveRoom(started);
    return started;
  }

  private requireWaitingRoom(roomId: string): Room {
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.status !== 'WAITING') throw new Error('GAME_ALREADY_STARTED');
    return room;
  }

  private assertNotInActiveRoom(playerId: string): void {
    if (this.store.findActiveRoomByPlayer(playerId)) throw new Error('PLAYER_ALREADY_IN_ROOM');
  }

  private toRoomPlayer(player: PlayerProfile, seat: number): RoomPlayer {
    return { id: player.id, nickname: player.nickname, avatarUrl: player.avatarUrl, seat, ready: false };
  }
}
