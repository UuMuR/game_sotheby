import type { PlayerGameView } from '@sotheby/contracts';

import { createGamePageModel } from './view-model.ts';
import { createGameSocket } from '../../services/game-socket.ts';
import type { ClientGameCommand } from '../../services/game-commands.ts';
import { session } from '../../services/runtime.ts';
import { gameStore } from '../../store/runtime.ts';

interface GamePageData {
  gameId: string;
  model: ReturnType<typeof createGamePageModel> | null;
  lotCards: readonly unknown[];
  connectionLabel: string;
  error: string;
}

interface GamePageContext {
  data: GamePageData;
  setData(data: Partial<GamePageData>): void;
  socket?: ReturnType<typeof createGameSocket>;
  unsubscribe?: () => void;
}

function socketPlatform() {
  return {
    connect({ url }: { url: string }) { return wx.connectSocket({ url }); },
    setTimeout: (handler: () => void, delay: number) => setTimeout(handler, delay) as unknown as number,
    clearTimeout: (timer: number) => clearTimeout(timer),
  };
}

Page({
  data: { gameId: '', model: null, lotCards: [], connectionLabel: '连接中', error: '' },
  onLoad(this: GamePageContext, options: { gameId?: string }) {
    const gameId = options.gameId ?? '';
    this.setData({ gameId });
    this.unsubscribe = gameStore.subscribe((view: PlayerGameView | null) => {
      if (!view) return;
      const model = createGamePageModel(view, new Date());
      this.setData({ model, connectionLabel: '已连接', error: gameStore.lastError()?.message ?? '' });
    });
    const token = session.current()?.token;
    if (token && gameId) {
      this.socket = createGameSocket(socketPlatform(), gameStore);
      this.socket.connect({ token, gameId });
    }
  },
  onUnload(this: GamePageContext) { this.unsubscribe?.(); this.socket?.disconnect(); },
  onAuctionAction(this: GamePageContext, event: { detail: ClientGameCommand }) { this.socket?.send(event.detail); },
  onCardSelect(this: GamePageContext, event: { detail: { cardId: string } }) { this.socket?.send({ type: 'PLAY_CARD', payload: event.detail }); },
});

export * from './view-model.ts';
