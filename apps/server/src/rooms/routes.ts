import type { FastifyInstance, FastifyRequest } from 'fastify';

import { bearerToken } from '../auth/routes.ts';
import type { SessionService } from '../auth/session-service.ts';
import type { RoomService } from './room-service.ts';

function statusFor(code: string): number {
  if (code === 'ROOM_NOT_FOUND') return 404;
  if (['ROOM_FULL', 'GAME_ALREADY_STARTED', 'INVALID_PLAYER_COUNT', 'PLAYERS_NOT_READY', 'PLAYER_ALREADY_IN_ROOM'].includes(code)) return 409;
  if (['NOT_ROOM_OWNER', 'PLAYER_NOT_IN_ROOM'].includes(code)) return 403;
  return 400;
}

async function playerOr401(request: FastifyRequest, sessionService: SessionService) {
  return await sessionService.authenticate(bearerToken(request));
}

export function registerRoomRoutes(app: FastifyInstance, roomService: RoomService, sessionService: SessionService): void {
  app.get('/v1/me/active-game', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const room = await roomService.findActiveRoom(player.id);
    return { gameId: room?.status === 'IN_GAME' ? room.gameId : undefined };
  });

  app.get('/v1/rooms/:id', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try {
      return await roomService.getForPlayer((request.params as { id: string }).id, player.id);
    } catch (error) {
      return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message });
    }
  });

  app.post('/v1/rooms', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return reply.code(201).send(await roomService.create(player)); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:code/join', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return await roomService.join((request.params as { code: string }).code, player); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:id/ready', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const body = request.body as { ready?: boolean };
    try { return await roomService.setReady((request.params as { id: string }).id, player.id, body.ready === true); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.post('/v1/rooms/:id/start', async (request, reply) => {
    const player = await playerOr401(request, sessionService);
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    try { return await roomService.start((request.params as { id: string }).id, player.id); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });

  app.delete('/v1/rooms/:id/players/:playerId', async (request, reply) => {
    const actor = await playerOr401(request, sessionService);
    if (!actor) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const params = request.params as { id: string; playerId: string };
    try { return (await roomService.removePlayer(params.id, actor.id, params.playerId)) ?? reply.code(204).send(); }
    catch (error) { return reply.code(statusFor((error as Error).message)).send({ code: (error as Error).message }); }
  });
}
