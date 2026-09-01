import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { EngineEvent } from '@sotheby/game-engine';

interface EventRow extends RowDataPacket {
  id: string;
  game_id: string;
  room_id: string;
  sequence: number;
  actor_player_id: string | null;
  occurred_at: Date;
  rules_version: string;
  type: string;
  payload: unknown;
}

export class EventRepository {
  constructor(private readonly pool: Pool) {}

  async listAfter(gameId: string, sequence: number): Promise<readonly EngineEvent[]> {
    const [rows] = await this.pool.query<EventRow[]>(
      `SELECT id, game_id, room_id, sequence, actor_player_id, occurred_at, rules_version, type, payload
       FROM game_events WHERE game_id = ? AND sequence > ? ORDER BY sequence ASC`,
      [gameId, sequence],
    );
    return rows.map((row) => ({
      eventId: row.id,
      gameId: row.game_id,
      roomId: row.room_id,
      sequence: row.sequence,
      actorPlayerId: row.actor_player_id,
      occurredAt: row.occurred_at.toISOString(),
      rulesVersion: row.rules_version,
      type: row.type,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    }));
  }
}
