import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthRoutes } from './auth/routes.ts';
import { SessionService, type AuthStore } from './auth/session-service.ts';
import type { WechatIdentityClient } from './auth/wechat-client.ts';
import { randomSixDigitRoomCode } from './rooms/room-code.ts';
import { registerRoomRoutes } from './rooms/routes.ts';
import { InMemoryLobbyStore, RoomService, type LobbyStore } from './rooms/room-service.ts';
import { CommandService, InMemoryGameSessionStore, type GameSessionStore } from './games/command-service.ts';
import { InMemoryConnectionRegistry, type ConnectionRegistry } from './games/connection-registry.ts';
import { InMemoryRoomLock, type RoomLock } from './games/room-lock.ts';
import { registerGameSocketRoute } from './games/socket-route.ts';

export interface BuildAppOptions {
  wechatClient: WechatIdentityClient;
  store?: LobbyStore & AuthStore;
  randomCode?: () => string;
  gameRuntime?: {
    gameStore: GameSessionStore;
    roomLock?: RoomLock;
    connections?: ConnectionRegistry;
  };
}


export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(websocket);
  const store = options.store ?? new InMemoryLobbyStore();
  const sessionService = new SessionService(store);
  const roomService = new RoomService(store, options.randomCode ?? (() => randomSixDigitRoomCode()));
  registerAuthRoutes(app, sessionService, options.wechatClient);
  registerRoomRoutes(app, roomService, sessionService);
  const gameStore = options.gameRuntime?.gameStore ?? new InMemoryGameSessionStore();
  const connections = options.gameRuntime?.connections ?? new InMemoryConnectionRegistry();
  const roomLock = options.gameRuntime?.roomLock ?? new InMemoryRoomLock();
  const commandService = new CommandService({ gameStore, connections, roomLock });
  void app.register(async (websocketScope) => {
    registerGameSocketRoute(websocketScope, { sessionService, gameStore, commandService, connections });
  });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
