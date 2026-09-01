interface HandDrawerContext {
  triggerEvent(name: string, detail: unknown): void;
}

Component({
  properties: { cards: { type: Array, value: [] } },
  methods: {
    select(this: HandDrawerContext, event: { currentTarget: { dataset: { id: string; selectable: boolean } } }) {
      if (event.currentTarget.dataset.selectable) {
        this.triggerEvent('select', { cardId: event.currentTarget.dataset.id });
      }
    },
  },
});
