import type { PlayerGameView } from '@sotheby/contracts';

import type { ClientGameCommand } from '../../services/game-commands.ts';
import { createRoundResultModel, roundResultInputFromGameView } from './view-model.ts';

export function createRoundResultPageState(view: PlayerGameView) {
  return {
    gameId: view.gameId,
    model: createRoundResultModel(roundResultInputFromGameView(view)),
  };
}

export function nextRoundCommand(): ClientGameCommand {
  return { type: 'ADVANCE_AFTER_SETTLEMENT', payload: {} };
}
