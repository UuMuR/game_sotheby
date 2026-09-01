import type { Pool, RowDataPacket } from 'mysql2/promise';

export interface RoomRecord {
  id: string;
  code: string;
  ownerPlayerId: string;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED' | 'DISBANDED';
}

interface RoomRow extends RowDataPacket {
  id: string;
  code: string;
  owner_player_id: string;
  status: RoomRecord['status'];
}

export class RoomRepository {
  constructor(private readonly pool: Pool) {}

  async findByCode(code: string): Promise<RoomRecord | null> {
    const [rows] = await this.pool.query<RoomRow[]>(
      'SELECT id, code, owner_player_id, status FROM rooms WHERE code = ? LIMIT 1',
      [code],
    );
    const row = rows[0];
    return row ? { id: row.id, code: row.code, ownerPlayerId: row.owner_player_id, status: row.status } : null;
  }
}
