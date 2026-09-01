interface HandDrawerContext {
  data: { isHost: boolean };
  triggerEvent(name: string, detail: unknown): void;
}

Component({
  properties: {
    cards: { type: Array, value: [] },
    isHost: Boolean,
  },
  methods: {
    select(this: HandDrawerContext, event: { currentTarget: { dataset: { id: string } } }) {
      if (this.data.isHost) {
        this.triggerEvent('select', { cardId: event.currentTarget.dataset.id });
      }
    },
  },
});
