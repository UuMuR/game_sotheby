import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { buildApp } from './app.ts';
import { HttpWechatIdentityClient } from './auth/wechat-client.ts';
import { loadConfig } from './config.ts';
import { createDatabaseConnection } from './db/client.ts';
import { MySqlLobbyStore } from './db/mysql-lobby-store.ts';
import { PersistentGameSessionStore } from './db/persistent-game-session-store.ts';
import { IoredisJsonClient } from './db/redis-game-session-store.ts';
import { MySqlGameRepository } from './db/repositories/game-repository.ts';
import { MySqlIdempotencyRepository } from './db/repositories/idempotency-repository.ts';
import { MySqlResultStore } from './db/repositories/mysql-result-store.ts';
import { InMemoryConnectionRegistry } from './games/connection-registry.ts';
import { RedisDeadlineStore } from './games/deadline-store.ts';
import { RedisRoomLock } from './games/room-lock.ts';

const config = loadConfig(process.env);
const redis = new Redis(config.REDIS_URL, { lazyConnect: true });
const database = createDatabaseConnection(config.DATABASE_URL);
const lobbyStore = new MySqlLobbyStore(database.pool, config.SESSION_SECRET);
const resultStore = new MySqlResultStore(database.pool);
const gameStore = new PersistentGameSessionStore(
  new IoredisJsonClient(redis),
  new MySqlGameRepository(database.pool),
  new MySqlIdempotencyRepository(database.pool),
);

const app = buildApp({
  wechatClient: new HttpWechatIdentityClient(config.WECHAT_APP_ID, config.WECHAT_APP_SECRET),
  store: lobbyStore,
  resultStore,
  gameRuntime: {
    gameStore,
    connections: new InMemoryConnectionRegistry(),
    roomLock: new RedisRoomLock(redis, randomUUID),
    deadlineStore: new RedisDeadlineStore(redis),
    startDeadlineWorker: true,
  },
});

await redis.connect();
await database.pool.query('SELECT 1');
await app.listen({ host: '0.0.0.0', port: config.PORT });

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await Promise.all([redis.quit(), database.pool.end()]);
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
