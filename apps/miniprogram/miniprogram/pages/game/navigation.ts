import type { PlayerGameView } from '@sotheby/contracts';

export function routeForGameState(view: PlayerGameView): string | null {
  if (view.status === 'ROUND_SETTLEMENT') {
    return `/pages/round-result/index?gameId=${view.gameId}`;
  }
  if (view.status === 'FINISHED') {
    return `/pages/final-result/index?gameId=${view.gameId}`;
  }
  return null;
}
