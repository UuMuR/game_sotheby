import type { Money } from '@sotheby/contracts';

import type { GameState } from './model.ts';

interface CommandBase {
  requestId: string;
  playerId: string;
  stateVersion: number;
}

export type GameCommandInput =
  | (CommandBase & { type: 'PLAY_CARD'; payload: { cardId: string } })
  | (CommandBase & { type: 'PLACE_OPEN_BID'; payload: { amount: Money } })
  | (CommandBase & { type: 'SET_FIXED_PRICE'; payload: { amount: Money } })
  | (CommandBase & { type: 'RESPOND_FIXED_PRICE'; payload: { accept: boolean } })
  | (CommandBase & { type: 'PLACE_SEQUENTIAL_BID'; payload: { amount: Money } })
  | (CommandBase & { type: 'PASS_SEQUENTIAL'; payload: Record<string, never> })
  | (CommandBase & { type: 'SUBMIT_SEALED_BID'; payload: { amount: Money } })
  | (CommandBase & { type: 'CHOOSE_SELF_JOINT_CARD'; payload: { cardId: string } })
  | (CommandBase & { type: 'INVITE_JOINT_PLAYER'; payload: Record<string, never> })
  | (CommandBase & { type: 'RESPOND_JOINT_INVITE'; payload: { accept: boolean; cardId?: string } })
  | (CommandBase & { type: 'EXPIRE_AUCTION'; payload: Record<string, never> });

export type CommandErrorCode =
  | 'STALE_STATE'
  | 'PLAYER_NOT_FOUND'
  | 'NOT_HOST'
  | 'CARD_NOT_FOUND'
  | 'INVALID_JOINT_CARD'
  | 'AUCTION_ACTIVE'
  | 'NO_ACTIVE_AUCTION'
  | 'WRONG_AUCTION_TYPE'
  | 'NOT_YOUR_TURN'
  | 'PLAYER_NOT_ELIGIBLE'
  | 'INVALID_AMOUNT'
  | 'INVALID_INCREMENT'
  | 'INSUFFICIENT_CASH'
  | 'AUCTION_EXPIRED'
  | 'AUCTION_NOT_EXPIRED';

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export interface Deadline {
  id: string;
  roomId: string;
  gameId: string;
  expectedStateVersion: number;
  expiresAt: string;
  action: 'EXPIRE_AUCTION';
}

export interface EngineEvent {
  eventId: string;
  sequence: number;
  gameId: string;
  roomId: string;
  actorPlayerId: string | null;
  occurredAt: string;
  rulesVersion: string;
  type: string;
  payload: unknown;
}

export type CommandResult =
  | {
      ok: true;
      state: GameState;
      events: readonly EngineEvent[];
      scheduledDeadlines: readonly Deadline[];
    }
  | {
      ok: false;
      state: GameState;
      error: CommandError;
      events: readonly [];
      scheduledDeadlines: readonly [];
    };
