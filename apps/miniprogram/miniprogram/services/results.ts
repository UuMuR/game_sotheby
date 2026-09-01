import type { HttpClient } from './http.ts';
import type { FinalStandingInput } from '../pages/final-result/view-model.ts';
import type { HistoryInput } from '../pages/history/view-model.ts';
import type { RoundResultInput } from '../pages/round-result/view-model.ts';

export interface GameResultResponse {
  gameId: string;
  roomCode: string;
  finishedAt: string;
  finalStandings: readonly FinalStandingInput[];
  publicRoundSummaries: readonly RoundResultInput['rankings'][];
  privateLedger: readonly RoundResultInput['ledger'][number][];
}

export function createResultClient(http: HttpClient) {
  return {
    getResult: (gameId: string) =>
      http.request<GameResultResponse>({ url: `/v1/games/${gameId}/result`, method: 'GET' }),
    getHistory: () =>
      http.request<readonly HistoryInput[]>({ url: '/v1/me/game-history', method: 'GET' }),
  };
}
