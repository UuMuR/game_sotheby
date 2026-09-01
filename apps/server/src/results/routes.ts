import type { FastifyInstance } from 'fastify';

import { bearerToken } from '../auth/routes.ts';
import type { SessionService } from '../auth/session-service.ts';
import type { ResultService } from './result-service.ts';

export function registerResultRoutes(
  app: FastifyInstance,
  resultService: ResultService,
  sessionService: SessionService,
): void {
  app.get('/v1/games/:gameId/result', async (request, reply) => {
    const player = sessionService.authenticate(bearerToken(request));
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try {
      return resultService.getForPlayer((request.params as { gameId: string }).gameId, player.id);
    } catch (error) {
      const code = (error as Error).message;
      return reply.code(code === 'GAME_RESULT_FORBIDDEN' ? 403 : 404).send({ code });
    }
  });

  app.get('/v1/me/game-history', async (request, reply) => {
    const player = sessionService.authenticate(bearerToken(request));
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    return resultService.listForPlayer(player.id);
  });
}
