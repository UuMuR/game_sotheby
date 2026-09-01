import { describe, expect, it } from 'vitest';

import { loadPlaceholderCatalog } from './catalog.ts';

function countBy<T, K extends string | number>(
  values: readonly T[],
  select: (value: T) => K,
): Record<K, number> {
  return values.reduce<Record<K, number>>((counts, value) => {
    const key = select(value);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {} as Record<K, number>);
}

describe('placeholder collection catalog', () => {
  it('contains the fixed 84-card series distribution', () => {
    const cards = loadPlaceholderCatalog();

    expect(cards).toHaveLength(84);
    expect(countBy(cards, (card) => card.series)).toEqual({
      BLACK: 15,
      BLUE: 16,
      GREEN: 17,
      YELLOW: 18,
      RED: 18,
    });
  });

  it('uses unique card ids and names', () => {
    const cards = loadPlaceholderCatalog();

    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
    expect(new Set(cards.map((card) => card.name)).size).toBe(cards.length);
  });

  it('restricts stolen cards to sealed bids', () => {
    const stolenCards = loadPlaceholderCatalog().filter((card) => card.stolen);

    expect(stolenCards).toHaveLength(15);
    expect(stolenCards.every((card) => card.auctionType === 'SEALED_BID')).toBe(true);
    expect(stolenCards.every((card) => card.auctionType !== 'JOINT')).toBe(true);
  });

  it('accepts only supported rarities and auction types', () => {
    const cards = loadPlaceholderCatalog();

    expect(cards.every((card) => card.rarity >= 1 && card.rarity <= 5)).toBe(true);
    expect(
      cards.every((card) =>
        ['OPEN', 'SEQUENTIAL', 'FIXED_PRICE', 'JOINT', 'SEALED_BID'].includes(
          card.auctionType,
        ),
      ),
    ).toBe(true);
  });
});
