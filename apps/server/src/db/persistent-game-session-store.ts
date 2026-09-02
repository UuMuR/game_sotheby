import type { EngineEvent, GameState } from '@sotheby/game-engine';

import type {
  CommandResponse,
  GameSessionStore,
} from '../games/command-service.ts';
import type {
  AppendEventsAndSnapshotInput,
  GameRepository,
} from './repositories/game-repository.ts';
import type { IdempotencyRepository } from './repositories/idempotency-repository.ts';
import type { RedisJsonClient } from './redis-game-session-store.ts';

export type PersistentCommitInput = AppendEventsAndSnapshotInput;

export interface TransactionalGameSessionStore extends GameSessionStore {
  commit(
    input: PersistentCommitInput,
    requestId: string,
    response: CommandResponse,
  ): Promise<void>;
}

export function supportsTransactionalCommit(
  store: GameSessionStore,
): store is TransactionalGameSessionStore {
  return 'commit' in store && typeof store.commit === 'function';
}

export class PersistentGameSessionStore implements TransactionalGameSessionStore {
  constructor(
    private readonly redis: RedisJsonClient,
    private readonly games: GameRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly afterCacheWrite: () => void = () => undefined,
  ) {}

  async get(gameId: string): Promise<GameState | null> {
    const cached = await this.redis.get(`game:state:${gameId}`);
    if (cached !== null) return JSON.parse(cached) as GameState;

    const recovery = await this.games.loadGameForRecovery(gameId);
    if (!recovery.snapshot) return null;
    // Every accepted command writes a complete snapshot. Later events indicate
    // an interrupted/legacy writer and are intentionally not guessed here.
    if (recovery.eventsAfterSnapshot.length > 0) {
      throw new Error(`GAME_RECOVERY_REQUIRES_REPLAY:${gameId}`);
    }
    await this.cacheState(recovery.snapshot);
    return recovery.snapshot;
  }

  async save(state: GameState): Promise<void> {
    await this.cacheState(state);
  }

  async findCommandResult(requestId: string): Promise<CommandResponse | null> {
    const cached = await this.redis.get(`game:command:${requestId}`);
    if (cached !== null) return JSON.parse(cached) as CommandResponse;
    const stored = await this.idempotency.findCommandResult<CommandResponse>(requestId);
    if (stored) {
      await this.redis.setExpiringValue(
        `game:command:${requestId}`,
        JSON.stringify(stored),
        86_400,
      );
    }
    return stored;
  }

  async saveCommandResult(requestId: string, result: CommandResponse): Promise<void> {
    await this.idempotency.saveCommandResult(requestId, result.state.gameId, result);
    await this.redis.setExpiringValue(
      `game:command:${requestId}`,
      JSON.stringify(result),
      86_400,
      true,
    );
  }

  async commit(
    input: PersistentCommitInput,
    requestId: string,
    response: CommandResponse,
  ): Promise<void> {
    await this.games.appendEventsAndSnapshot({
      ...input,
      requestId,
      commandResult: response,
    });
    await this.cacheState(input.nextState);
    await this.redis.setExpiringValue(
      `game:command:${requestId}`,
      JSON.stringify(response),
      86_400,
      true,
    );
  }

  private async cacheState(state: GameState): Promise<void> {
    await this.redis.setValue(`game:state:${state.gameId}`, JSON.stringify(state));
    this.afterCacheWrite();
  }
}

export type PersistedEngineEvent = EngineEvent;
