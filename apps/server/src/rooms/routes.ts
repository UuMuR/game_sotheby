import type { FastifyInstance, FastifyRequest } from 'fastify';

import { bearerToken } from '../auth/routes.ts';
import type { SessionService } from '../auth/session-service.ts';
import type { RoomService } from './room-service.ts';

function statusFor(code: string): number {
  if (code === 'ROOM_NOT_FOUND') return 404;
  if (['ROOM_FULL', 'GAME_ALREADY_STARTED', 'INVALID_PLAYER_COUNT', 'PLAYERS_NOT_READY', 'PLAYER_ALREADY_IN_ROOM'].includes(code)) return 409;
  if (['NOT_ROOM_OWNER'].includes(code)) return 403;
  return 400;
}

function playerOr401(request: FastifyRequest, sessionService: SessionService) {
  return sessionService.authenticate(bearerToken(request));
}

export function registerRoomRoutes(app: FastifyInstance, roomService: RoomService, sessionService: SessionService): void {
  app.post('/v1/rooms', async (request, reply) => {
    const player = playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return reply.code(201).send(roomService.create(player)); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:code/join', async (request, reply) => {
    const player = playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return roomService.join((request.params as { code: string }).code, player); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:id/ready', async (request, reply) => {
    const player = playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const body = request.body as { ready?: boolean };
    try { return roomService.setReady((request.params as { id: string }).id, player.id, body.ready === true); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:id/start', async (request, reply) => {
    const player = playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return roomService.start((request.params as { id: string }).id, player.id); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.delete('/v1/rooms/:id/players/:playerId', async (request, reply) => {
    const actor = playerOr401(request, sessionService);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const params = request.params as { id: string; playerId: string };
    try { return roomService.removePlayer(params.id, actor.id, params.playerId) ?? reply.code(204).send(); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });
}
