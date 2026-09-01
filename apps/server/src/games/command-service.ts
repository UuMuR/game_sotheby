import {
  handleCommand,
  projectForPlayer,
  type GameCommandInput,
  type GameState,
} from '@sotheby/game-engine';

import { GameBroadcaster } from './broadcaster.ts';
import type { ConnectionRegistry } from './connection-registry.ts';
import type { RoomLock } from './room-lock.ts';

export interface ClientCommandEnvelope {
  type: 'COMMAND';
  requestId: string;
  roomId: string;
  gameId: string;
  playerId: string;
  stateVersion: number;
  command: Omit<GameCommandInput, 'requestId' | 'playerId' | 'stateVersion'>;
}

export type CommandResponse =
  | {
      type: 'COMMAND_ACCEPTED';
      requestId: string;
      state: ReturnType<typeof projectForPlayer>;
      events: readonly unknown[];
    }
  | {
      type: 'COMMAND_REJECTED';
      requestId: string;
      error: { code: string; message: string };
      state: ReturnType<typeof projectForPlayer>;
    };

export interface GameSessionStore {
  get(gameId: string): GameState | null;
  save(state: GameState): void;
  findCommandResult(requestId: string): CommandResponse | null;
  saveCommandResult(requestId: string, result: CommandResponse): void;
}

export class InMemoryGameSessionStore implements GameSessionStore {
  private readonly games = new Map<string, GameState>();
  private readonly results = new Map<string, CommandResponse>();

  seed(state: GameState): void { this.save(state); }
  get(gameId: string): GameState | null { return structuredClone(this.games.get(gameId) ?? null); }
  save(state: GameState): void { this.games.set(state.gameId, structuredClone(state)); }
  findCommandResult(requestId: string): CommandResponse | null { return structuredClone(this.results.get(requestId) ?? null); }
  saveCommandResult(requestId: string, result: CommandResponse): void {
    if (!this.results.has(requestId)) this.results.set(requestId, structuredClone(result));
  }
}

export class CommandService {
  private readonly broadcaster: GameBroadcaster;

  constructor(
    private readonly dependencies: {
      gameStore: GameSessionStore;
      roomLock: RoomLock;
      connections: ConnectionRegistry;
    },
  ) {
    this.broadcaster = new GameBroadcaster(dependencies.connections);
  }

  async hostPlayerId(gameId: string): Promise<string> {
    const state = this.dependencies.gameStore.get(gameId);
    if (!state) throw new Error('GAME_NOT_FOUND');
    return state.hostPlayerId;
  }

  async execute(envelope: ClientCommandEnvelope, now: Date): Promise<CommandResponse> {
    return this.dependencies.roomLock.runExclusive(envelope.roomId, async () => {
      const duplicate = this.dependencies.gameStore.findCommandResult(envelope.requestId);
      if (duplicate) return duplicate;

      const state = this.dependencies.gameStore.get(envelope.gameId);
      if (!state || state.roomId !== envelope.roomId || !state.players[envelope.playerId]) {
        throw new Error('GAME_NOT_FOUND');
      }

      const command = {
        ...envelope.command,
        requestId: envelope.requestId,
        playerId: envelope.playerId,
        stateVersion: envelope.stateVersion,
      } as GameCommandInput;
      const result = handleCommand(state, command, now);
      let response: CommandResponse;
      if (result.ok) {
        this.dependencies.gameStore.save(result.state);
        response = {
          type: 'COMMAND_ACCEPTED',
          requestId: envelope.requestId,
          state: projectForPlayer(result.state, envelope.playerId),
          events: result.events,
        };
        this.broadcaster.broadcastState(result.state);
      } else {
        response = {
          type: 'COMMAND_REJECTED',
          requestId: envelope.requestId,
          error: result.error,
          state: projectForPlayer(result.state, envelope.playerId),
        };
      }
      this.dependencies.gameStore.saveCommandResult(envelope.requestId, response);
      return response;
    });
  }
}
