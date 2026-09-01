interface BidPanelContext {
  triggerEvent(name: string, detail: unknown): void;
}

Component({
  properties: {
    auction: Object,
    actions: { type: Array, value: [] },
    remainingSeconds: Number,
  },
  methods: {
    act(this: BidPanelContext, event: { currentTarget: { dataset: { action: unknown } } }) {
      this.triggerEvent('action', event.currentTarget.dataset.action);
    },
  },
});
