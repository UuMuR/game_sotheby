import type { PlayerGameView } from '@sotheby/contracts';

import { moneyLabel } from '../round-result/view-model.ts';

export interface FinalStandingInput {
  playerId: string;
  nickname: string;
  cash: number;
  place: number;
  winner: boolean;
}

export function createFinalResultModel(standings: readonly FinalStandingInput[]) {
  const winnerNames = standings.filter((standing) => standing.place === 1).map((standing) => standing.nickname);
  return {
    winnerNames,
    winnerLabel: winnerNames.join('、'),
    rows: standings.map((standing) => ({ ...standing, cashLabel: moneyLabel(standing.cash) })),
  };
}


export function finalStandingsFromGameView(view: PlayerGameView): readonly FinalStandingInput[] {
  if (!view.finalStandings) throw new Error('FINAL_STANDINGS_MISSING');
  const names = new Map(view.players.map((player) => [player.id, player.nickname]));
  return view.finalStandings.map((standing) => ({
    ...standing,
    nickname: names.get(standing.playerId) ?? '已注销玩家',
  }));
}
