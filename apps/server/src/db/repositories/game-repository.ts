import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { EngineEvent, GameState } from '@sotheby/game-engine';

export interface AppendEventsAndSnapshotInput {
  gameId: string;
  expectedStateVersion: number;
  nextState: GameState;
  events: readonly EngineEvent[];
  writeSnapshot: boolean;
  requestId?: string;
  commandResult?: unknown;
}

export interface RecoveredGame {
  snapshot: GameState | null;
  eventsAfterSnapshot: readonly EngineEvent[];
}

export interface GameRepository {
  appendEventsAndSnapshot(input: AppendEventsAndSnapshotInput): Promise<GameState>;
  loadGameForRecovery(gameId: string): Promise<RecoveredGame>;
}

export class StateVersionConflictError extends Error {
  constructor() {
    super('Game state version does not match expected state version');
  }
}

export class EventSequenceConflictError extends Error {
  constructor() {
    super('Game event sequence must be strictly increasing and unique');
  }
}

export class InMemoryGameRepository implements GameRepository {
  private readonly snapshots = new Map<string, GameState>();
  private readonly events = new Map<string, EngineEvent[]>();

  seedSnapshot(state: GameState): void {
    this.snapshots.set(state.gameId, structuredClone(state));
  }

  seedEvent(event: EngineEvent): void {
    const events = this.events.get(event.gameId) ?? [];
    events.push(structuredClone(event));
    this.events.set(event.gameId, events);
  }

  async appendEventsAndSnapshot(input: AppendEventsAndSnapshotInput): Promise<GameState> {
    const current = this.snapshots.get(input.gameId);
    if ((current?.stateVersion ?? input.expectedStateVersion) !== input.expectedStateVersion) {
      throw new StateVersionConflictError();
    }

    const existingEvents = this.events.get(input.gameId) ?? [];
    const existingSequences = new Set(existingEvents.map((event) => event.sequence));
    let previousSequence = current?.eventSequence ?? 0;
    for (const event of input.events) {
      if (existingSequences.has(event.sequence) || event.sequence <= previousSequence) {
        throw new EventSequenceConflictError();
      }
      previousSequence = event.sequence;
    }

    const nextEvents = [...existingEvents, ...input.events.map((event) => structuredClone(event))];
    this.events.set(input.gameId, nextEvents);
    if (input.writeSnapshot) this.snapshots.set(input.gameId, structuredClone(input.nextState));
    return structuredClone(input.nextState);
  }

  async loadGameForRecovery(gameId: string): Promise<RecoveredGame> {
    const snapshot = this.snapshots.get(gameId);
    const snapshotSequence = snapshot?.eventSequence ?? 0;
    const eventsAfterSnapshot = (this.events.get(gameId) ?? [])
      .filter((event) => event.sequence > snapshotSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => structuredClone(event));
    return {
      snapshot: snapshot ? structuredClone(snapshot) : null,
      eventsAfterSnapshot,
    };
  }
}

interface VersionRow extends RowDataPacket {
  state_version: number;
}

interface SnapshotRow extends RowDataPacket {
  state: GameState;
  event_sequence: number;
}

interface EventRow extends RowDataPacket {
  id: string;
  game_id: string;
  room_id: string;
  actor_player_id: string | null;
  occurred_at: Date;
  rules_version: string;
  type: string;
  payload: unknown;
  sequence: number;
}

export class MySqlGameRepository implements GameRepository {
  constructor(private readonly pool: Pool) {}

  async appendEventsAndSnapshot(input: AppendEventsAndSnapshotInput): Promise<GameState> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.assertVersion(connection, input.gameId, input.expectedStateVersion);
      for (const gameEvent of input.events) {
        await connection.execute(
          `INSERT INTO game_events
           (id, game_id, room_id, sequence, request_id, actor_player_id, type, rules_version, payload, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            gameEvent.eventId,
            gameEvent.gameId,
            gameEvent.roomId,
            gameEvent.sequence,
            input.requestId ?? null,
            gameEvent.actorPlayerId,
            gameEvent.type,
            gameEvent.rulesVersion,
            JSON.stringify(gameEvent.payload),
            new Date(gameEvent.occurredAt),
          ],
        );
      }
      await connection.execute(
        'UPDATE games SET state_version = ?, event_sequence = ?, status = ? WHERE id = ?',
        [input.nextState.stateVersion, input.nextState.eventSequence, input.nextState.status, input.gameId],
      );
      if (input.writeSnapshot) {
        await connection.execute(
          `INSERT INTO game_snapshots (id, game_id, state_version, event_sequence, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE event_sequence = VALUES(event_sequence), state = VALUES(state), created_at = VALUES(created_at)`,
          [
            `${input.gameId}:${input.nextState.stateVersion}`,
            input.gameId,
            input.nextState.stateVersion,
            input.nextState.eventSequence,
            JSON.stringify(input.nextState),
            new Date(),
          ],
        );
      }
      if (input.requestId !== undefined && input.commandResult !== undefined) {
        await connection.execute(
          `INSERT INTO command_results (request_id, game_id, result, created_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE request_id = request_id`,
          [input.requestId, input.gameId, JSON.stringify(input.commandResult), new Date()],
        );
      }
      await connection.commit();
      return input.nextState;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async loadGameForRecovery(gameId: string): Promise<RecoveredGame> {
    const [snapshotRows] = await this.pool.query<SnapshotRow[]>(
      `SELECT state, event_sequence FROM game_snapshots
       WHERE game_id = ? ORDER BY state_version DESC LIMIT 1`,
      [gameId],
    );
    const snapshotRow = snapshotRows[0];
    const snapshot = snapshotRow ? parseJson<GameState>(snapshotRow.state) : null;
    const [eventRows] = await this.pool.query<EventRow[]>(
      `SELECT id, game_id, room_id, sequence, actor_player_id, occurred_at, rules_version, type, payload
       FROM game_events WHERE game_id = ? AND sequence > ? ORDER BY sequence ASC`,
      [gameId, snapshotRow?.event_sequence ?? 0],
    );
    return {
      snapshot,
      eventsAfterSnapshot: eventRows.map((row) => ({
        eventId: row.id,
        gameId: row.game_id,
        roomId: row.room_id,
        sequence: row.sequence,
        actorPlayerId: row.actor_player_id,
        occurredAt: row.occurred_at.toISOString(),
        rulesVersion: row.rules_version,
        type: row.type,
        payload: parseJson(row.payload),
      })),
    };
  }

  private async assertVersion(
    connection: PoolConnection,
    gameId: string,
    expectedStateVersion: number,
  ): Promise<void> {
    const [rows] = await connection.query<VersionRow[]>(
      'SELECT state_version FROM games WHERE id = ? FOR UPDATE',
      [gameId],
    );
    const current = rows[0];
    if (!current || current.state_version !== expectedStateVersion) {
      throw new StateVersionConflictError();
    }
  }
}

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
