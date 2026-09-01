import { describe, expect, it } from 'vitest';

import type { PlayerGameView } from '@sotheby/contracts';

import { createGameStore } from '../miniprogram/store/game-store.ts';

function view(version: number): PlayerGameView {
  return {
    roomId: 'room-1', gameId: 'game-1', stateVersion: version, eventSequence: version,
    round: 1, hostPlayerId: 'p1',
    self: { id: 'p1', nickname: 'P1', avatarUrl: '/1.png', seat: 0, online: true, isHost: true, isActing: false, purchasedCards: [], handCount: 1, cash: 100, hand: [] },
    players: [], seriesCounts: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 },
    cumulativeSeriesPrices: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 },
    auction: null,
  };
}

describe('game store', () => {
  it('replaces state snapshots and ignores older versions', () => {
    const store = createGameStore();
    expect(store.applyServerState(view(4))).toBe(true);
    expect(store.applyServerState(view(3))).toBe(false);
    expect(store.current()?.stateVersion).toBe(4);
  });

  it('replaces optimistic state after a command rejection', () => {
    const store = createGameStore();
    store.applyServerState(view(4));
    store.markCommandPending('request-1');
    store.applyCommandRejected({ requestId: 'request-1', state: view(5), error: { code: 'STALE_STATE', message: 'stale' } });
    expect(store.current()?.stateVersion).toBe(5);
    expect(store.pendingRequestIds()).toEqual([]);
    expect(store.lastError()?.code).toBe('STALE_STATE');
  });
});

describe('game socket lifecycle', () => {
  it('requests a fresh state after opening and after reconnecting', async () => {
    const sent: string[] = [];
    let openHandler: (() => void) | undefined;
    let closeHandler: (() => void) | undefined;
    const { createGameSocket } = await import('../miniprogram/services/game-socket.ts');
    const socket = createGameSocket({
      connect() {
        return {
          send({ data }) { sent.push(data); },
          close() {},
          onOpen(handler) { openHandler = handler; },
          onMessage() {},
          onClose(handler) { closeHandler = handler; },
          onError() {},
        };
      },
      setTimeout(handler) { handler(); return 1; },
      clearTimeout() {},
    });

    socket.connect({ token: 'token-1', gameId: 'game-1' });
    openHandler?.();
    closeHandler?.();
    openHandler?.();

    expect(sent.map((value) => JSON.parse(value))).toEqual([
      { type: 'SYNC_STATE' },
      { type: 'SYNC_STATE' },
    ]);
  });
});
