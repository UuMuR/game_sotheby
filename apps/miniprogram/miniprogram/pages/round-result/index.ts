import type { PlayerGameView } from '@sotheby/contracts';

import { createRoundResultPageState, nextRoundCommand } from './controller.ts';
import { createGameSocket } from '../../services/game-socket.ts';
import { session } from '../../services/runtime.ts';
import { gameStore } from '../../store/runtime.ts';

interface Context {
  data: { gameId: string; model: ReturnType<typeof createRoundResultPageState>['model'] | null };
  setData(data: Partial<Context['data']>): void;
  socket?: ReturnType<typeof createGameSocket>;
  unsubscribe?: () => void;
}

function platformSocket() {
  return {
    connect: ({ url }: { url: string }) => wx.connectSocket({ url }),
    setTimeout: (handler: () => void, delay: number) => setTimeout(handler, delay) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };
}

Page({
  data: { gameId: '', model: null },
  onLoad(this: Context, options: { gameId?: string }) {
    const gameId = options.gameId ?? '';
    this.setData({ gameId });
    this.unsubscribe = gameStore.subscribe((view: PlayerGameView | null) => {
      if (!view || view.gameId !== gameId) return;
      if (view.status === 'ROUND_SETTLEMENT') {
        this.setData(createRoundResultPageState(view));
      } else if (view.status === 'IN_PROGRESS') {
        wx.redirectTo({ url: `/pages/game/index?gameId=${gameId}` });
      } else if (view.status === 'FINISHED') {
        wx.redirectTo({ url: `/pages/final-result/index?gameId=${gameId}` });
      }
    });
    const token = session.current()?.token;
    if (token && gameId) {
      this.socket = createGameSocket(platformSocket(), gameStore);
      this.socket.connect({ token, gameId });
    }
  },
  onContinue(this: Context) {
    this.socket?.send(nextRoundCommand());
  },
  onUnload(this: Context) {
    this.unsubscribe?.();
    this.socket?.disconnect();
  },
});

export * from './view-model.ts';
