import { z } from 'zod';

export const COLLECTION_SERIES = ['BLACK', 'BLUE', 'GREEN', 'YELLOW', 'RED'] as const;
export const CollectionSeriesSchema = z.enum(COLLECTION_SERIES);
export type CollectionSeries = z.infer<typeof CollectionSeriesSchema>;

export const AUCTION_TYPES = [
  'OPEN',
  'SEQUENTIAL',
  'FIXED_PRICE',
  'JOINT',
  'SEALED_BID',
] as const;
export const AuctionTypeSchema = z.enum(AUCTION_TYPES);
export type AuctionType = z.infer<typeof AuctionTypeSchema>;

export const CardDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  series: CollectionSeriesSchema,
  rarity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  auctionType: AuctionTypeSchema,
  stolen: z.boolean(),
  imageKey: z.string().min(1),
});

export type CardDefinition = z.infer<typeof CardDefinitionSchema>;
