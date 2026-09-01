import type { PlayerGameView } from '@sotheby/contracts';

import { WS_BASE_URL } from '../config.ts';

import type { ClientGameCommand } from './game-commands.ts';
import { createCommandEnvelope } from './game-commands.ts';
import type { GameStore } from '../store/game-store.ts';

export interface SocketTaskLike {
  send(options: { data: string }): void;
  close(options?: { code?: number; reason?: string }): void;
  onOpen(handler: () => void): void;
  onMessage(handler: (message: { data: string | ArrayBuffer }) => void): void;
  onClose(handler: () => void): void;
  onError(handler: (error: unknown) => void): void;
}

export interface SocketPlatform {
  connect(options: { url: string }): SocketTaskLike;
  setTimeout(handler: () => void, delay: number): number;
  clearTimeout(timer: number): void;
}

export interface GameSocketOptions {
  token: string;
  gameId: string;
}

export function createGameSocket(platform: SocketPlatform, store?: GameStore) {
  let socket: SocketTaskLike | null = null;
  let options: GameSocketOptions | null = null;
  let reconnectTimer: number | null = null;
  let closedByUser = false;

  const connect = (next: GameSocketOptions): void => {
    options = next;
    closedByUser = false;
    socket = platform.connect({
      url: `${WS_BASE_URL}/v1/games/${next.gameId}/socket?token=${encodeURIComponent(next.token)}`,
    });
    socket.onOpen(() => socket?.send({ data: JSON.stringify({ type: 'SYNC_STATE' }) }));
    socket.onMessage((message) => {
      if (!store || typeof message.data !== 'string') return;
      const payload = JSON.parse(message.data) as
        | { type: 'STATE'; state: PlayerGameView }
        | { type: 'COMMAND_ACCEPTED'; requestId: string; state: PlayerGameView }
        | { type: 'COMMAND_REJECTED'; requestId: string; state: PlayerGameView; error: { code: string; message: string } };
      if (payload.type === 'STATE') store.applyServerState(payload.state);
      if (payload.type === 'COMMAND_ACCEPTED') store.applyCommandAccepted(payload);
      if (payload.type === 'COMMAND_REJECTED') store.applyCommandRejected(payload);
    });
    socket.onClose(() => {
      socket = null;
      if (!closedByUser && options) reconnectTimer = platform.setTimeout(() => connect(options!), 1000);
    });
    socket.onError(() => undefined);
  };

  return {
    connect,
    send(command: ClientGameCommand): string {
      if (!socket || !options || !store?.current()) throw new Error('GAME_SOCKET_NOT_READY');
      const state = store.current()!;
      const envelope = createCommandEnvelope(state.roomId, state.gameId, state.self.id, state.stateVersion, command);
      store.markCommandPending(envelope.requestId);
      socket.send({ data: JSON.stringify(envelope) });
      return envelope.requestId;
    },
    disconnect(): void {
      closedByUser = true;
      if (reconnectTimer !== null) platform.clearTimeout(reconnectTimer);
      socket?.close({ code: 1000, reason: 'CLIENT_CLOSED' });
      socket = null;
    },
  };
}
