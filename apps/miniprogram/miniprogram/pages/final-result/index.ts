import type { PlayerGameView } from '@sotheby/contracts';

import { finalResultModelFromResponse } from './controller.ts';
import { createFinalResultModel, finalStandingsFromGameView } from './view-model.ts';
import { results } from '../../services/runtime.ts';
import { gameStore } from '../../store/runtime.ts';

interface Context {
  data: { gameId: string; model: ReturnType<typeof createFinalResultModel> | null; loading: boolean };
  setData(data: Partial<Context['data']>): void;
}

Page({
  data: { gameId: '', model: null, loading: true },
  async onLoad(this: Context, options: { gameId?: string }) {
    const gameId = options.gameId ?? '';
    this.setData({ gameId });
    const live: PlayerGameView | null = gameStore.current();
    if (live?.gameId === gameId && live.status === 'FINISHED') {
      this.setData({ model: createFinalResultModel(finalStandingsFromGameView(live)), loading: false });
      return;
    }
    try {
      const result = await results.getResult(gameId);
      this.setData({ model: finalResultModelFromResponse(result), loading: false });
    } catch {
      this.setData({ loading: false });
      wx.showToast({ title: '结算结果加载失败', icon: 'none' });
    }
  },
  onBackHome() {
    gameStore.reset();
    wx.reLaunch({ url: '/pages/home/index' });
  },
});

export * from './view-model.ts';
