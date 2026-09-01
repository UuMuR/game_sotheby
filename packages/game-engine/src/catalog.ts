import {
  AUCTION_TYPES,
  CardDefinitionSchema,
  COLLECTION_SERIES,
  type CardDefinition,
  type CollectionSeries,
} from '@sotheby/contracts';
import catalogJson from '../../../docs/data/placeholder-collections.json' with { type: 'json' };
import { z } from 'zod';

const EXPECTED_SERIES_COUNTS: Readonly<Record<CollectionSeries, number>> = {
  BLACK: 15,
  BLUE: 16,
  GREEN: 17,
  YELLOW: 18,
  RED: 18,
};

const CatalogSchema = z.object({
  schemaVersion: z.number().int().positive(),
  status: z.string().min(1),
  description: z.string().min(1),
  currencyUnit: z.literal('TEN_THOUSAND_CNY'),
  seriesPriority: z.tuple([
    z.literal('BLACK'),
    z.literal('BLUE'),
    z.literal('GREEN'),
    z.literal('YELLOW'),
    z.literal('RED'),
  ]),
  cards: z.array(CardDefinitionSchema),
});

function assertUnique(cards: readonly CardDefinition[], select: (card: CardDefinition) => string, label: string): void {
  const values = cards.map(select);
  if (new Set(values).size !== values.length) {
    throw new Error(`Catalog contains duplicate ${label}`);
  }
}

export function validateCatalog(input: unknown): readonly CardDefinition[] {
  const catalog = CatalogSchema.parse(input);
  const cards = catalog.cards;

  if (cards.length !== 84) {
    throw new Error(`Catalog must contain 84 cards, received ${cards.length}`);
  }

  assertUnique(cards, (card) => card.id, 'card ids');
  assertUnique(cards, (card) => card.name, 'card names');

  for (const series of COLLECTION_SERIES) {
    const actual = cards.filter((card) => card.series === series).length;
    const expected = EXPECTED_SERIES_COUNTS[series];
    if (actual !== expected) {
      throw new Error(`Series ${series} must contain ${expected} cards, received ${actual}`);
    }
  }

  for (const card of cards) {
    if (!AUCTION_TYPES.includes(card.auctionType)) {
      throw new Error(`Card ${card.id} has an unsupported auction type`);
    }
    if (card.stolen && card.auctionType !== 'SEALED_BID') {
      throw new Error(`Stolen card ${card.id} must use SEALED_BID`);
    }
  }

  return Object.freeze(cards.map((card) => Object.freeze({ ...card })));
}

let cachedCatalog: readonly CardDefinition[] | undefined;

export function loadPlaceholderCatalog(): readonly CardDefinition[] {
  cachedCatalog ??= validateCatalog(catalogJson);
  return cachedCatalog;
}
