import type { Pool, RowDataPacket } from 'mysql2/promise';

export interface IdempotencyRepository {
  findCommandResult<T>(requestId: string): Promise<T | null>;
  saveCommandResult(requestId: string, gameId: string, result: unknown): Promise<void>;
}

export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly results = new Map<string, unknown>();

  async findCommandResult<T>(requestId: string): Promise<T | null> {
    return (structuredClone(this.results.get(requestId)) as T | undefined) ?? null;
  }

  async saveCommandResult(requestId: string, _gameId: string, result: unknown): Promise<void> {
    if (!this.results.has(requestId)) this.results.set(requestId, structuredClone(result));
  }
}

interface CommandResultRow extends RowDataPacket {
  result: unknown;
}

export class MySqlIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly pool: Pool) {}

  async findCommandResult<T>(requestId: string): Promise<T | null> {
    const [rows] = await this.pool.query<CommandResultRow[]>(
      'SELECT result FROM command_results WHERE request_id = ? LIMIT 1',
      [requestId],
    );
    const value = rows[0]?.result;
    if (value === undefined) return null;
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  }

  async saveCommandResult(requestId: string, gameId: string, result: unknown): Promise<void> {
    await this.pool.execute(
      'INSERT IGNORE INTO command_results (request_id, game_id, result, created_at) VALUES (?, ?, ?, ?)',
      [requestId, gameId, JSON.stringify(result), new Date()],
    );
  }
}
