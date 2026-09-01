import type { CardDefinition } from '@sotheby/contracts';

import type { GameState } from '../model.ts';

export type RoundEndDecision =
  | { ended: false }
  | {
      ended: true;
      reason: 'SIXTH_CARD';
      triggerCardId: string;
      voidCardIds: readonly string[];
    };

export function checkRoundEnd(
  state: GameState,
  playedCards: readonly CardDefinition[],
): RoundEndDecision {
  const pendingCounts = { ...state.seriesCounts };

  for (let index = 0; index < playedCards.length; index += 1) {
    const current = playedCards[index];
    if (current === undefined) continue;

    if (pendingCounts[current.series] >= 5) {
      return {
        ended: true,
        reason: 'SIXTH_CARD',
        triggerCardId: current.id,
        voidCardIds: playedCards.slice(0, index + 1).map((card) => card.id),
      };
    }

    pendingCounts[current.series] += 1;
  }

  return { ended: false };
}

export function areAllHandsEmpty(state: GameState): boolean {
  return Object.values(state.players).every((player) => player.hand.length === 0);
}
