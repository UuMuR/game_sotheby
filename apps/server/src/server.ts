import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { buildApp } from './app.ts';
import { HttpWechatIdentityClient } from './auth/wechat-client.ts';
import { loadConfig } from './config.ts';
import { InMemoryGameSessionStore } from './games/command-service.ts';
import { InMemoryConnectionRegistry } from './games/connection-registry.ts';
import { RedisRoomLock } from './games/room-lock.ts';

const config = loadConfig(process.env);
const redis = new Redis(config.REDIS_URL, { lazyConnect: true });
const app = buildApp({
  wechatClient: new HttpWechatIdentityClient(config.WECHAT_APP_ID, config.WECHAT_APP_SECRET),
  gameRuntime: {
    gameStore: new InMemoryGameSessionStore(),
    connections: new InMemoryConnectionRegistry(),
    roomLock: new RedisRoomLock(redis, randomUUID),
  },
});

await redis.connect();
await app.listen({ host: '0.0.0.0', port: config.PORT });

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await redis.quit();
}

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
