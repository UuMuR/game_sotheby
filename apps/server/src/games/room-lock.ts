import type { Redis } from 'ioredis';

export interface RoomLock {
  runExclusive<T>(roomId: string, operation: () => Promise<T>): Promise<T>;
}

export class InMemoryRoomLock implements RoomLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(roomId, previous.then(() => current));
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(roomId) === current) this.tails.delete(roomId);
    }
  }
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

export class RedisRoomLock implements RoomLock {
  constructor(
    private readonly redis: Redis,
    private readonly tokenFactory: () => string,
    private readonly retryDelayMs = 10,
  ) {}

  async runExclusive<T>(roomId: string, operation: () => Promise<T>): Promise<T> {
    const key = `lock:room:${roomId}`;
    const token = this.tokenFactory();
    for (;;) {
      const acquired = await this.redis.set(key, token, 'PX', 5_000, 'NX');
      if (acquired === 'OK') break;
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
    }
    try {
      return await operation();
    } finally {
      await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
    }
  }
}
