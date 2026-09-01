import { z } from 'zod';

export const GameEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  gameId: z.string().min(1),
  roomId: z.string().min(1),
  actorPlayerId: z.string().min(1).nullable(),
  occurredAt: z.string().datetime(),
  rulesVersion: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown(),
});

export type GameEvent<TType extends string = string, TPayload = unknown> = Omit<
  z.infer<typeof GameEventEnvelopeSchema>,
  'type' | 'payload'
> & {
  type: TType;
  payload: TPayload;
};
