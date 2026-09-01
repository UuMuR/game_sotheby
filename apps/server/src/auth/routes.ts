import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { SessionService } from './session-service.ts';
import type { WechatIdentityClient } from './wechat-client.ts';

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

export function registerAuthRoutes(app: FastifyInstance, sessionService: SessionService, wechatClient: WechatIdentityClient): void {
  app.post('/v1/auth/wechat-login', async (request, reply) => {
    const body = request.body as { code?: string };
    if (!body.code) return reply.code(400).send({ code: 'INVALID_LOGIN_CODE' });
    const identity = await wechatClient.exchangeCode(body.code);
    return sessionService.login(identity.openId);
  });

  app.post('/v1/profile', async (request, reply) => {
    const player = sessionService.authenticate(bearerToken(request));
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const body = request.body as { nickname?: string; avatarUrl?: string };
    try {
      return sessionService.updateProfile(player.id, body.nickname ?? '', body.avatarUrl ?? '');
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_NICKNAME') return reply.code(400).send({ code: error.message });
      throw error;
    }
  });

  app.patch('/v1/profile', async (request, reply) => {
    const player = sessionService.authenticate(bearerToken(request));
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    const body = request.body as { nickname?: string; avatarUrl?: string };
    try {
      return sessionService.updateProfile(player.id, body.nickname ?? '', body.avatarUrl ?? '');
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_NICKNAME') return reply.code(400).send({ code: error.message });
      throw error;
    }
  });

  app.delete('/v1/account', async (request, reply) => {
    const player = sessionService.authenticate(bearerToken(request));
    if (!player) return reply.code(401).send({ code: 'UNAUTHORIZED' });
    sessionService.deleteAccount(player.id);
    return reply.code(204).send();
  });
}
