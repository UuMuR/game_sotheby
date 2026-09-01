import { moneyLabel } from '../round-result/view-model.ts';

export interface FinalStandingInput {
  playerId: string;
  nickname: string;
  cash: number;
  place: number;
  winner: boolean;
}

export function createFinalResultModel(standings: readonly FinalStandingInput[]) {
  return {
    winnerNames: standings.filter((standing) => standing.place === 1).map((standing) => standing.nickname),
    rows: standings.map((standing) => ({ ...standing, cashLabel: moneyLabel(standing.cash) })),
  };
}
