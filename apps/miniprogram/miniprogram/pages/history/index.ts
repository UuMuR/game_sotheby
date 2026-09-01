import { createHistoryModel, type HistoryInput } from './view-model.ts';
import { results } from '../../services/runtime.ts';

interface Context {
  data: { rows: ReturnType<typeof createHistoryModel>; loading: boolean };
  setData(data: Partial<Context['data']>): void;
}

Page({
  data: { rows: [], loading: true },
  async onShow(this: Context) {
    this.setData({ loading: true });
    try {
      const history: readonly HistoryInput[] = await results.getHistory();
      this.setData({ rows: createHistoryModel(history), loading: false });
    } catch {
      this.setData({ rows: [], loading: false });
      wx.showToast({ title: '历史记录加载失败', icon: 'none' });
    }
  },
});

export * from './view-model.ts';
