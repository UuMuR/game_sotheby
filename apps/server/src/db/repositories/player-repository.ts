import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export interface PlayerRecord {
  id: string;
  wechatOpenId: string;
  nickname: string;
  avatarUrl: string;
  deleted: boolean;
}

interface PlayerRow extends RowDataPacket {
  id: string;
  wechat_open_id: string;
  nickname: string;
  avatar_url: string;
  deleted: number;
}

export class PlayerRepository {
  constructor(private readonly pool: Pool) {}

  async findByWechatOpenId(openId: string): Promise<PlayerRecord | null> {
    const [rows] = await this.pool.query<PlayerRow[]>(
      'SELECT id, wechat_open_id, nickname, avatar_url, deleted FROM players WHERE wechat_open_id = ? LIMIT 1',
      [openId],
    );
    const row = rows[0];
    return row
      ? { id: row.id, wechatOpenId: row.wechat_open_id, nickname: row.nickname, avatarUrl: row.avatar_url, deleted: Boolean(row.deleted) }
      : null;
  }

  async updateProfile(playerId: string, nickname: string, avatarUrl: string): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      'UPDATE players SET nickname = ?, avatar_url = ? WHERE id = ? AND deleted = false',
      [nickname, avatarUrl, playerId],
    );
    return result.affectedRows === 1;
  }
}
