import type { GameCommandInput, GameState } from '@sotheby/game-engine';

export interface BotCommandFactory {
  create<T extends GameCommandInput['type']>(
    state: GameState,
    playerId: string,
    type: T,
    payload: Extract<GameCommandInput, { type: T }>['payload'],
  ): Extract<GameCommandInput, { type: T }>;
}

export function createBotCommandFactory(): BotCommandFactory {
  let requestSequence = 0;
  return {
    create(state, playerId, type, payload) {
      requestSequence += 1;
      return {
        requestId: `bot-${requestSequence}`,
        playerId,
        stateVersion: state.stateVersion,
        type,
        payload,
      } as Extract<GameCommandInput, { type: typeof type }>;
    },
  };
}
