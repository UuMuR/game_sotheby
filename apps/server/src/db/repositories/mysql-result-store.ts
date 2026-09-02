import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { ResultStore, StoredGameResult } from '../../results/result-service.ts';

interface ResultRow extends RowDataPacket {
  result: unknown;
}

function parseResult(value: unknown): StoredGameResult {
  return (typeof value === 'string' ? JSON.parse(value) : value) as StoredGameResult;
}

export class MySqlResultStore implements ResultStore {
  constructor(private readonly pool: Pool) {}

  async save(result: StoredGameResult): Promise<void> {
    await this.pool.execute(
      `INSERT INTO game_results (game_id, result, finished_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE result = VALUES(result), finished_at = VALUES(finished_at)`,
      [result.gameId, JSON.stringify(result), new Date(result.finishedAt)],
    );
  }

  async get(gameId: string): Promise<StoredGameResult | null> {
    const [rows] = await this.pool.query<ResultRow[]>(
      'SELECT result FROM game_results WHERE game_id = ? LIMIT 1',
      [gameId],
    );
    const row = rows[0];
    return row ? parseResult(row.result) : null;
  }

  async listForPlayer(playerId: string): Promise<readonly StoredGameResult[]> {
    const [rows] = await this.pool.query<ResultRow[]>(
      `SELECT gr.result
       FROM game_results gr
       JOIN game_players gp ON gp.game_id = gr.game_id
       WHERE gp.player_id = ?
       ORDER BY gr.finished_at DESC`,
      [playerId],
    );
    return rows.map((row) => parseResult(row.result));
  }
}
