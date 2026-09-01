const labels: Record<string, string> = { BLACK: '黑', BLUE: '蓝', GREEN: '绿', YELLOW: '黄', RED: '红' };

interface MarketPanelContext {
  setData(data: { rows: Array<{ name: string; label: string; count: number; price: number }> }): void;
}

Component({
  properties: { counts: Object, prices: Object },
  data: { rows: [] as Array<{ name: string; label: string; count: number; price: number }> },
  observers: {
    'counts, prices'(this: MarketPanelContext, counts: Record<string, number> = {}, prices: Record<string, number> = {}) {
      this.setData({
        rows: ['BLACK', 'BLUE', 'GREEN', 'YELLOW', 'RED'].map((name) => ({
          name,
          label: labels[name] ?? name,
          count: counts[name] ?? 0,
          price: prices[name] ?? 0,
        })),
      });
    },
  },
});
