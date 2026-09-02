import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import { projectForPlayer } from '@sotheby/game-engine';

import type { SessionService } from '../auth/session-service.ts';
import type { CommandService, ClientCommandEnvelope, GameSessionStore } from './command-service.ts';
import type { ConnectionRegistry } from './connection-registry.ts';

export async function sendCurrentState(
  connections: ConnectionRegistry,
  gameStore: GameSessionStore,
  gameId: string,
  playerId: string,
): Promise<boolean> {
  const state = await gameStore.get(gameId);
  if (!state || !state.players[playerId]) return false;
  connections.send(gameId, playerId, { type: 'STATE', state: projectForPlayer(state, playerId) });
  return true;
}

export function registerGameSocketRoute(
  app: FastifyInstance,
  dependencies: {
    sessionService: SessionService;
    gameStore: GameSessionStore;
    commandService: CommandService;
    connections: ConnectionRegistry;
  },
): void {
  app.get('/v1/games/:gameId/socket', { websocket: true }, (socket: WebSocket, request) => {
    const query = request.query as { token?: string };
    const params = request.params as { gameId: string };
    const sessionPromise = dependencies.sessionService.authenticate(query.token);
    let removeConnection: (() => void) | undefined;

    socket.on('message', async (data) => {
      try {
        const player = await sessionPromise;
        if (!player) {
          socket.close(1008, 'UNAUTHORIZED');
          return;
        }
        const message = JSON.parse(data.toString()) as
          | { type: 'SYNC_STATE' }
          | Omit<ClientCommandEnvelope, 'playerId' | 'gameId'>;
        if (message.type === 'SYNC_STATE') {
          await sendCurrentState(
            dependencies.connections,
            dependencies.gameStore,
            params.gameId,
            player.id,
          );
          return;
        }
        const response = await dependencies.commandService.execute(
          { ...message, gameId: params.gameId, playerId: player.id },
          new Date(),
        );
        socket.send(JSON.stringify(response));
      } catch {
        socket.send(JSON.stringify({
          type: 'COMMAND_REJECTED',
          error: { code: 'INVALID_MESSAGE', message: 'Invalid WebSocket message' },
        }));
      }
    });
    socket.on('close', () => removeConnection?.());

    void sessionPromise.then(async (player) => {
      const state = await dependencies.gameStore.get(params.gameId);
      if (!player || !state || !state.players[player.id]) {
        socket.close(1008, 'UNAUTHORIZED');
        return;
      }
      removeConnection = dependencies.connections.add(params.gameId, player.id, socket);
      await sendCurrentState(
        dependencies.connections,
        dependencies.gameStore,
        params.gameId,
        player.id,
      );
    });
  });
}
