import { handleCommand, type EngineEvent, type GameState } from '@sotheby/game-engine';

import type { GameSessionStore } from './command-service.ts';

export interface RecoverySource {
  listActiveGameIds(): Promise<readonly string[]>;
  loadGameForRecovery(gameId: string): Promise<{
    snapshot: GameState | null;
    eventsAfterSnapshot: readonly EngineEvent[];
  }>;
}

function replayKnownEvent(state: GameState, gameEvent: EngineEvent): GameState {
  if (gameEvent.type === 'CARD_PLAYED' && gameEvent.actorPlayerId) {
    const payload = gameEvent.payload as { cardId?: string };
    if (!payload.cardId) throw new Error(`Event ${gameEvent.eventId} is missing cardId`);
    const result = handleCommand(
      state,
      {
        requestId: `replay:${gameEvent.eventId}`,
        playerId: gameEvent.actorPlayerId,
        stateVersion: state.stateVersion,
        type: 'PLAY_CARD',
        payload: { cardId: payload.cardId },
      },
      new Date(gameEvent.occurredAt),
    );
    if (!result.ok) throw new Error(`Cannot replay ${gameEvent.eventId}: ${result.error.code}`);
    return result.state;
  }
  throw new Error(`Unsupported recovery event type ${gameEvent.type}`);
}

export class RecoveryService {
  constructor(
    private readonly source: RecoverySource,
    private readonly cache: GameSessionStore,
  ) {}

  async recoverActiveGames(): Promise<void> {
    for (const gameId of await this.source.listActiveGameIds()) {
      const recovery = await this.source.loadGameForRecovery(gameId);
      if (!recovery.snapshot) continue;
      let state = recovery.snapshot;
      for (const gameEvent of recovery.eventsAfterSnapshot) {
        if (gameEvent.sequence !== state.eventSequence + 1) {
          throw new Error(`Recovery event sequence gap for ${gameId}`);
        }
        state = replayKnownEvent(state, gameEvent);
      }
      this.cache.save(state);
    }
  }
}
