import type { Redis } from 'ioredis';

import type { GameState } from '@sotheby/game-engine';

import type { CommandResponse, GameSessionStore } from '../games/command-service.ts';

export interface RedisJsonClient {
  get(key: string): Promise<string | null>;
  setValue(key: string, value: string): Promise<void>;
  setExpiringValue(
    key: string,
    value: string,
    ttlSeconds: number,
    onlyIfMissing?: boolean,
  ): Promise<void>;
}

export class IoredisJsonClient implements RedisJsonClient {
  constructor(private readonly redis: Redis) {}

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setValue(key: string, value: string): Promise<void> {
    await this.redis.set(key, value);
  }

  async setExpiringValue(
    key: string,
    value: string,
    ttlSeconds: number,
    onlyIfMissing = false,
  ): Promise<void> {
    if (onlyIfMissing) {
      await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
      return;
    }
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }
}

function parseJson<T>(value: string | null): T | null {
  return value === null ? null : JSON.parse(value) as T;
}

export class RedisGameSessionStore implements GameSessionStore {
  constructor(private readonly redis: RedisJsonClient) {}

  async get(gameId: string): Promise<GameState | null> {
    return parseJson<GameState>(await this.redis.get(`game:state:${gameId}`));
  }

  async save(state: GameState): Promise<void> {
    await this.redis.setValue(`game:state:${state.gameId}`, JSON.stringify(state));
  }

  async findCommandResult(requestId: string): Promise<CommandResponse | null> {
    return parseJson<CommandResponse>(await this.redis.get(`game:command:${requestId}`));
  }

  async saveCommandResult(requestId: string, result: CommandResponse): Promise<void> {
    await this.redis.setExpiringValue(
      `game:command:${requestId}`,
      JSON.stringify(result),
      86_400,
      true,
    );
  }
}
