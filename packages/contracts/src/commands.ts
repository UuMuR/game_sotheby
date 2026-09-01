import { z } from 'zod';

export const GameCommandEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  roomId: z.string().min(1),
  playerId: z.string().min(1),
  stateVersion: z.number().int().nonnegative(),
  type: z.string().min(1),
  payload: z.unknown(),
});

export type GameCommand<TType extends string = string, TPayload = unknown> = Omit<
  z.infer<typeof GameCommandEnvelopeSchema>,
  'type' | 'payload'
> & {
  type: TType;
  payload: TPayload;
};
