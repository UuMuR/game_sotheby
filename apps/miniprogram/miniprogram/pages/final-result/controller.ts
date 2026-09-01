import { createFinalResultModel, type FinalStandingInput } from './view-model.ts';
import type { GameResultResponse } from '../../services/results.ts';

export function finalResultModelFromResponse(result: GameResultResponse) {
  return createFinalResultModel(result.finalStandings as readonly FinalStandingInput[]);
}
