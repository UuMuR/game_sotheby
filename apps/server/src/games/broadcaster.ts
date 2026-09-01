import { projectForPlayer, type GameState } from '@sotheby/game-engine';

import type { ConnectionRegistry } from './connection-registry.ts';

export class GameBroadcaster {
  constructor(private readonly connections: ConnectionRegistry) {}

  broadcastState(state: GameState): void {
    for (const playerId of this.connections.connectedPlayerIds(state.gameId)) {
      if (state.players[playerId]) {
        this.connections.send(state.gameId, playerId, {
          type: 'STATE',
          state: projectForPlayer(state, playerId),
        });
      }
    }
  }
}
