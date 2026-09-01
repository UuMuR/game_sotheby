import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthRoutes } from './auth/routes.ts';
import { SessionService, type AuthStore } from './auth/session-service.ts';
import type { WechatIdentityClient } from './auth/wechat-client.ts';
import { randomSixDigitRoomCode } from './rooms/room-code.ts';
import { registerRoomRoutes } from './rooms/routes.ts';
import { InMemoryLobbyStore, RoomService, type LobbyStore } from './rooms/room-service.ts';

export interface BuildAppOptions {
  wechatClient: WechatIdentityClient;
  store?: LobbyStore & AuthStore;
  randomCode?: () => string;
}


export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = options.store ?? new InMemoryLobbyStore();
  const sessionService = new SessionService(store);
  const roomService = new RoomService(store, options.randomCode ?? (() => randomSixDigitRoomCode()));
  registerAuthRoutes(app, sessionService, options.wechatClient);
  registerRoomRoutes(app, roomService, sessionService);
  app.get('/health', async () => ({ ok: true }));
  return app;
}
