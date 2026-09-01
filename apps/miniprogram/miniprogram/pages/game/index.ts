import type { PlayerGameView } from '@sotheby/contracts';

import { actionToCommand, commandForCardSelection } from './actions.ts';
import { routeForGameState } from './navigation.ts';
import { createGamePageModel, createVisibleCards } from './view-model.ts';
import { createGameSocket } from '../../services/game-socket.ts';
import { platform, session } from '../../services/runtime.ts';
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
  navigatedVersion?: number;
  countdownTimer?: number;
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
      const route = routeForGameState(view);
      if (route && this.navigatedVersion !== view.stateVersion) {
        this.navigatedVersion = view.stateVersion;
        platform.redirectTo(route);
        return;
      }
      const model = createGamePageModel(view, new Date());
      this.setData({
        model,
        lotCards: createVisibleCards(view.auction?.cardIds ?? []),
        connectionLabel: '已连接',
        error: gameStore.lastError()?.message ?? '',
      });
    });
    const token = session.current()?.token;
    if (token && gameId) {
      this.socket = createGameSocket(socketPlatform(), gameStore);
      this.socket.connect({ token, gameId });
    }
    this.countdownTimer = setInterval(() => {
      const view = gameStore.current();
      if (view?.status === 'IN_PROGRESS') this.setData({ model: createGamePageModel(view, new Date()) });
    }, 1000) as unknown as number;
  },
  onUnload(this: GamePageContext) {
    this.unsubscribe?.();
    this.socket?.disconnect();
    if (this.countdownTimer !== undefined) clearInterval(this.countdownTimer);
  },
  onAuctionAction(this: GamePageContext, event: { detail: { type: string; minimumAmount?: number; amount?: number; cardId?: string } }) {
    try {
      this.socket?.send(actionToCommand(event.detail, event.detail));
    } catch (error) {
      wx.showToast({ title: error instanceof Error && error.message === 'CARD_REQUIRED' ? '请从手牌中选择藏品' : '操作失败', icon: 'none' });
    }
  },
  onCardSelect(this: GamePageContext, event: { detail: { cardId: string } }) {
    this.socket?.send(commandForCardSelection(this.data.model?.auction ?? null, event.detail.cardId));
  },
});

export * from './view-model.ts';
