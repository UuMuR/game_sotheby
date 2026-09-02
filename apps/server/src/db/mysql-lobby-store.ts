import { createHmac, randomUUID } from 'node:crypto';

import type {
  Pool,
  RowDataPacket,
} from 'mysql2/promise';

import type { GameState } from '@sotheby/game-engine';

import type {
  AuthStore,
  PlayerProfile,
  Session,
} from '../auth/session-service.ts';
import type {
  LobbyStore,
  Room,
  RoomPlayer,
  RoomStatus,
} from '../rooms/room-service.ts';

interface PlayerRow extends RowDataPacket {
  id: string;
  wechat_open_id: string;
  nickname: string;
  avatar_url: string;
  deleted: number;
}

interface SessionRow extends RowDataPacket {
  id: string;
  player_id: string;
  expires_at: Date | string;
}

interface RoomJoinRow extends RowDataPacket {
  id: string;
  code: string;
  owner_player_id: string;
  status: RoomStatus;
  game_id: string | null;
  player_id: string | null;
  nickname: string | null;
  avatar_url: string | null;
  seat: number | null;
  ready: number | null;
}

interface SnapshotRow extends RowDataPacket {
  state: unknown;
}

export class MySqlLobbyStore implements LobbyStore, AuthStore {
  constructor(
    private readonly pool: Pool,
    private readonly sessionSecret: string,
  ) {}

  async findPlayerByOpenId(openId: string): Promise<PlayerProfile | null> {
    const [rows] = await this.pool.query<PlayerRow[]>(
      `SELECT id, wechat_open_id, nickname, avatar_url, deleted
       FROM players WHERE wechat_open_id = ? LIMIT 1`,
      [openId],
    );
    return rows[0] ? this.toPlayer(rows[0]) : null;
  }

  async findPlayerById(playerId: string): Promise<PlayerProfile | null> {
    const [rows] = await this.pool.query<PlayerRow[]>(
      `SELECT id, wechat_open_id, nickname, avatar_url, deleted
       FROM players WHERE id = ? LIMIT 1`,
      [playerId],
    );
    return rows[0] ? this.toPlayer(rows[0]) : null;
  }

  async savePlayer(player: PlayerProfile): Promise<void> {
    await this.pool.execute(
      `INSERT INTO players (id, wechat_open_id, nickname, avatar_url, deleted)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         wechat_open_id = VALUES(wechat_open_id),
         nickname = VALUES(nickname),
         avatar_url = VALUES(avatar_url),
         deleted = VALUES(deleted)`,
      [
        player.id,
        player.wechatOpenId,
        player.nickname,
        player.avatarUrl,
        player.deleted,
      ],
    );
  }

  async findSession(token: string): Promise<Session | null> {
    const [rows] = await this.pool.query<SessionRow[]>(
      `SELECT id, player_id, expires_at
       FROM sessions WHERE token_hash = ? LIMIT 1`,
      [this.hashToken(token)],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      token,
      playerId: row.player_id,
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  async saveSession(session: Session): Promise<void> {
    await this.pool.execute(
      `INSERT INTO sessions (id, player_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         player_id = VALUES(player_id),
         expires_at = VALUES(expires_at)`,
      [
        randomUUID(),
        session.playerId,
        this.hashToken(session.token),
        new Date(session.expiresAt),
      ],
    );
  }

  async deleteSessionsForPlayer(playerId: string): Promise<void> {
    await this.pool.execute('DELETE FROM sessions WHERE player_id = ?', [playerId]);
  }

  async getRoom(roomId: string): Promise<Room | null> {
    return this.loadRoom('r.id = ?', [roomId]);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    return this.loadRoom('r.code = ?', [code]);
  }

  async saveRoom(room: Room): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO rooms (id, code, owner_player_id, status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           code = VALUES(code),
           owner_player_id = VALUES(owner_player_id),
           status = VALUES(status)`,
        [room.id, room.code, room.ownerPlayerId, room.status],
      );
      await connection.execute('DELETE FROM room_players WHERE room_id = ?', [room.id]);
      for (const player of room.players) {
        await connection.execute(
          `INSERT INTO room_players (room_id, player_id, seat, ready)
           VALUES (?, ?, ?, ?)`,
          [room.id, player.id, player.seat, player.ready],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('DELETE FROM room_players WHERE room_id = ?', [roomId]);
      await connection.execute('DELETE FROM rooms WHERE id = ?', [roomId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findActiveRoomByPlayer(playerId: string): Promise<Room | null> {
    const [rows] = await this.pool.query<Array<RowDataPacket & { room_id: string }>>(
      `SELECT rp.room_id
       FROM room_players rp
       JOIN rooms r ON r.id = rp.room_id
       WHERE rp.player_id = ? AND r.status IN ('WAITING', 'IN_GAME')
       ORDER BY r.created_at DESC LIMIT 1`,
      [playerId],
    );
    return rows[0] ? this.getRoom(rows[0].room_id) : null;
  }

  async saveGame(game: GameState): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO games
           (id, room_id, status, state_version, event_sequence, rules_version, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           state_version = VALUES(state_version),
           event_sequence = VALUES(event_sequence),
           rules_version = VALUES(rules_version),
           finished_at = VALUES(finished_at)`,
        [
          game.gameId,
          game.roomId,
          game.status,
          game.stateVersion,
          game.eventSequence,
          game.rulesVersion,
          game.status === 'FINISHED' ? new Date() : null,
        ],
      );
      for (const playerId of game.seatOrder) {
        const player = game.players[playerId];
        if (!player) continue;
        await connection.execute(
          `INSERT INTO game_players
             (game_id, player_id, seat, nickname_snapshot, avatar_url_snapshot,
              final_cash, final_place, winner)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             nickname_snapshot = VALUES(nickname_snapshot),
             avatar_url_snapshot = VALUES(avatar_url_snapshot),
             final_cash = VALUES(final_cash),
             final_place = VALUES(final_place),
             winner = VALUES(winner)`,
          [
            game.gameId,
            playerId,
            player.seat,
            player.nickname,
            player.avatarUrl,
            game.finalStandings?.find((item) => item.playerId === playerId)?.cash ?? null,
            game.finalStandings?.find((item) => item.playerId === playerId)?.place ?? null,
            game.finalStandings?.find((item) => item.playerId === playerId)?.winner ?? null,
          ],
        );
      }
      await connection.execute(
        `INSERT INTO game_snapshots
           (id, game_id, state_version, event_sequence, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           event_sequence = VALUES(event_sequence),
           state = VALUES(state),
           created_at = VALUES(created_at)`,
        [
          `${game.gameId}:${game.stateVersion}`,
          game.gameId,
          game.stateVersion,
          game.eventSequence,
          JSON.stringify(game),
          new Date(),
        ],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async getGame(gameId: string): Promise<GameState | null> {
    const [rows] = await this.pool.query<SnapshotRow[]>(
      `SELECT state FROM game_snapshots
       WHERE game_id = ? ORDER BY state_version DESC LIMIT 1`,
      [gameId],
    );
    const value = rows[0]?.state;
    return value === undefined
      ? null
      : (typeof value === 'string' ? JSON.parse(value) : value) as GameState;
  }

  private async loadRoom(where: string, params: unknown[]): Promise<Room | null> {
    const [rows] = await this.pool.query<RoomJoinRow[]>(
      `SELECT
         r.id, r.code, r.owner_player_id, r.status,
         g.id AS game_id,
         rp.player_id, p.nickname, p.avatar_url, rp.seat, rp.ready
       FROM rooms r
       LEFT JOIN games g ON g.room_id = r.id
       LEFT JOIN room_players rp ON rp.room_id = r.id
       LEFT JOIN players p ON p.id = rp.player_id
       WHERE ${where}
       ORDER BY rp.seat ASC`,
      params,
    );
    const first = rows[0];
    if (!first) return null;
    const players: RoomPlayer[] = rows
      .filter((row) => row.player_id !== null)
      .map((row) => ({
        id: row.player_id!,
        nickname: row.nickname ?? '已注销玩家',
        avatarUrl: row.avatar_url ?? '/assets/avatars/default.png',
        seat: row.seat ?? 0,
        ready: Boolean(row.ready),
      }));
    return {
      id: first.id,
      code: first.code,
      ownerPlayerId: first.owner_player_id,
      status: first.status,
      players,
      ...(first.game_id ? { gameId: first.game_id } : {}),
    };
  }

  private toPlayer(row: PlayerRow): PlayerProfile {
    return {
      id: row.id,
      wechatOpenId: row.wechat_open_id,
      nickname: row.nickname,
      avatarUrl: row.avatar_url,
      profileComplete: row.nickname.trim().length > 0,
      deleted: Boolean(row.deleted),
    };
  }

  private hashToken(token: string): string {
    return createHmac('sha256', this.sessionSecret).update(token).digest('hex');
  }
}
