import type { GameAction } from '../../pages/game/view-model.ts';

interface BidPanelContext {
  data: { amount: string };
  setData(data: { amount: string }): void;
  triggerEvent(name: string, detail: unknown): void;
}

Component({
  properties: {
    auction: Object,
    actions: { type: Array, value: [] },
    remainingSeconds: Number,
  },
  data: { amount: '' },
  methods: {
    onAmountInput(this: BidPanelContext, event: { detail: { value: string } }) {
      this.setData({ amount: event.detail.value });
    },
    act(this: BidPanelContext, event: { currentTarget: { dataset: { action: GameAction } } }) {
      const action = event.currentTarget.dataset.action;
      const numeric = Number(this.data.amount);
      if (action.requiresAmount && (!Number.isInteger(numeric) || numeric < (action.minimumAmount ?? 0))) {
        wx.showToast({ title: `请输入至少 ${action.minimumAmount ?? 0} 万`, icon: 'none' });
        return;
      }
      this.triggerEvent('action', {
        ...action,
        ...(action.requiresAmount ? { amount: numeric } : {}),
      });
    },
  },
});
