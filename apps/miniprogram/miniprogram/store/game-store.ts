import type { PlayerGameView } from '@sotheby/contracts';

export interface CommandRejection {
  requestId: string;
  error: { code: string; message: string };
  state: PlayerGameView;
}

export function createGameStore() {
  let state: PlayerGameView | null = null;
  let error: CommandRejection['error'] | null = null;
  const pending = new Set<string>();
  const listeners = new Set<(value: PlayerGameView | null) => void>();

  const notify = (): void => {
    for (const listener of listeners) listener(state);
  };

  return {
    current: (): PlayerGameView | null => state,
    lastError: (): CommandRejection['error'] | null => error,
    pendingRequestIds: (): readonly string[] => [...pending],
    subscribe(listener: (value: PlayerGameView | null) => void): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    applyServerState(next: PlayerGameView): boolean {
      if (state !== null && next.stateVersion < state.stateVersion) return false;
      state = next;
      error = null;
      notify();
      return true;
    },
    markCommandPending(requestId: string): void {
      pending.add(requestId);
    },
    applyCommandAccepted(input: { requestId: string; state: PlayerGameView }): void {
      pending.delete(input.requestId);
      this.applyServerState(input.state);
    },
    applyCommandRejected(input: CommandRejection): void {
      pending.delete(input.requestId);
      error = input.error;
      this.applyServerState(input.state);
      error = input.error;
    },
    reset(): void {
      state = null;
      error = null;
      pending.clear();
      notify();
    },
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
