import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuthRoutes } from './auth/routes.ts';
import { SessionService, type AuthStore } from './auth/session-service.ts';
import type { WechatIdentityClient } from './auth/wechat-client.ts';
import { randomSixDigitRoomCode } from './rooms/room-code.ts';
import { registerRoomRoutes } from './rooms/routes.ts';
import { InMemoryLobbyStore, RoomService, type LobbyStore } from './rooms/room-service.ts';
import { BackingGameSessionStore, CommandService, type GameSessionStore } from './games/command-service.ts';
import { InMemoryConnectionRegistry, type ConnectionRegistry } from './games/connection-registry.ts';
import { InMemoryRoomLock, type RoomLock } from './games/room-lock.ts';
import { DeadlineWorker, type DeadlineStore } from './games/deadline-store.ts';
import { registerGameSocketRoute } from './games/socket-route.ts';
import { InMemoryResultStore, ResultService, type ResultStore } from './results/result-service.ts';
import { registerResultRoutes } from './results/routes.ts';

export interface BuildAppOptions {
  wechatClient: WechatIdentityClient;
  store?: LobbyStore & AuthStore;
  randomCode?: () => string;
  resultStore?: ResultStore;
  gameRuntime?: {
    gameStore?: GameSessionStore;
    roomLock?: RoomLock;
    connections?: ConnectionRegistry;
    deadlineStore?: DeadlineStore;
    startDeadlineWorker?: boolean;
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
  const resultStore = options.resultStore ?? new InMemoryResultStore();
  registerResultRoutes(app, new ResultService(resultStore), sessionService);
  const gameStore = options.gameRuntime?.gameStore ?? new BackingGameSessionStore(store);
  const connections = options.gameRuntime?.connections ?? new InMemoryConnectionRegistry();
  const roomLock = options.gameRuntime?.roomLock ?? new InMemoryRoomLock();
  const deadlineStore = options.gameRuntime?.deadlineStore;
  const commandService = new CommandService({
    gameStore,
    connections,
    roomLock,
    resultStore,
    ...(deadlineStore === undefined ? {} : { deadlineStore }),
    roomCodeFor: (roomId) => store.getRoom(roomId)?.code ?? roomId,
    onGameFinished: (state) => roomService.markFinished(state.roomId),
  });
  if (options.gameRuntime?.startDeadlineWorker && deadlineStore) {
    const worker = new DeadlineWorker(deadlineStore, commandService);
    const timer = setInterval(() => void worker.runOnce(new Date()), 250);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
  void app.register(async (websocketScope) => {
    registerGameSocketRoute(websocketScope, { sessionService, gameStore, commandService, connections });
  });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
