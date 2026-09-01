import type { CollectionSeries, Money } from '@sotheby/contracts';
import { COLLECTION_SERIES } from '@sotheby/contracts';

export interface RankedSeries {
  series: CollectionSeries;
  count: number;
  addedPrice: Money;
}

const ADDED_PRICES: readonly Money[] = [30, 20, 10, 0, 0];

export function rankSeries(
  counts: Readonly<Record<CollectionSeries, number>>,
): readonly RankedSeries[] {
  return [...COLLECTION_SERIES]
    .sort((left, right) => counts[right] - counts[left])
    .map((series, index) => ({
      series,
      count: counts[series],
      addedPrice: ADDED_PRICES[index] ?? 0,
    }));
}
