import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import { projectForPlayer } from '@sotheby/game-engine';

import type { SessionService } from '../auth/session-service.ts';
import type { CommandService, ClientCommandEnvelope, GameSessionStore } from './command-service.ts';
import type { ConnectionRegistry } from './connection-registry.ts';

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
    const player = dependencies.sessionService.authenticate(query.token);
    const state = dependencies.gameStore.get(params.gameId);

    if (!player || !state || !state.players[player.id]) {
      socket.close(1008, 'UNAUTHORIZED');
      return;
    }

    const remove = dependencies.connections.add(params.gameId, player.id, socket);
    socket.send(JSON.stringify({ type: 'STATE', state: projectForPlayer(state, player.id) }));

    socket.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString()) as Omit<ClientCommandEnvelope, 'playerId' | 'gameId'>;
        const response = await dependencies.commandService.execute(
          { ...message, gameId: params.gameId, playerId: player.id },
          new Date(),
        );
        socket.send(JSON.stringify(response));
      } catch {
        socket.send(JSON.stringify({ type: 'COMMAND_REJECTED', error: { code: 'INVALID_MESSAGE', message: 'Invalid WebSocket message' } }));
      }
    });
    socket.on('close', remove);
  });
}
