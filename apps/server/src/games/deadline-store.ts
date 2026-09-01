import type { Redis } from 'ioredis';

import type { Deadline } from '@sotheby/game-engine';

import type { CommandService } from './command-service.ts';

export interface DeadlineStore {
  schedule(deadline: Deadline): Promise<void>;
  claimDue(now: Date): Promise<Deadline | null>;
}

export class InMemoryDeadlineStore implements DeadlineStore {
  private readonly deadlines = new Map<string, Deadline>();

  async schedule(deadline: Deadline): Promise<void> {
    this.deadlines.set(deadline.id, structuredClone(deadline));
  }

  async claimDue(now: Date): Promise<Deadline | null> {
    const due = [...this.deadlines.values()]
      .filter((deadline) => Date.parse(deadline.expiresAt) <= now.getTime())
      .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))[0];
    if (!due) return null;
    this.deadlines.delete(due.id);
    return structuredClone(due);
  }
}

const CLAIM_DUE_SCRIPT = `
local entries = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #entries == 0 then return nil end
local payload = redis.call('HGET', KEYS[2], entries[1])
if payload then
  redis.call('ZREM', KEYS[1], entries[1])
  redis.call('HDEL', KEYS[2], entries[1])
end
return payload`;

export class RedisDeadlineStore implements DeadlineStore {
  constructor(private readonly redis: Redis) {}

  async schedule(deadline: Deadline): Promise<void> {
    const score = Date.parse(deadline.expiresAt);
    await this.redis
      .multi()
      .hset('game:deadline-payloads', deadline.id, JSON.stringify(deadline))
      .zadd('game:deadlines', score, deadline.id)
      .exec();
  }

  async claimDue(now: Date): Promise<Deadline | null> {
    const payload = await this.redis.eval(
      CLAIM_DUE_SCRIPT,
      2,
      'game:deadlines',
      'game:deadline-payloads',
      now.getTime(),
    );
    return typeof payload === 'string' ? (JSON.parse(payload) as Deadline) : null;
  }
}

export class DeadlineWorker {
  constructor(
    private readonly deadlines: DeadlineStore,
    private readonly commands: CommandService,
  ) {}

  async runOnce(now: Date): Promise<boolean> {
    const deadline = await this.deadlines.claimDue(now);
    if (!deadline) return false;
    await this.commands.execute(
      {
        type: 'COMMAND',
        requestId: `deadline:${deadline.gameId}:${deadline.id}:${deadline.expectedStateVersion}`,
        roomId: deadline.roomId,
        gameId: deadline.gameId,
        playerId: await this.commands.hostPlayerId(deadline.gameId),
        stateVersion: deadline.expectedStateVersion,
        command: { type: deadline.action, payload: {} },
      },
      now,
    );
    return true;
  }
}
