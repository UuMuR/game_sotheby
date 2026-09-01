import type { AuctionType, CardDefinition, CollectionSeries } from './cards.ts';

export type Money = number;

export interface PublicPlayerView {
  id: string;
  nickname: string;
  avatarUrl: string;
  seat: number;
  online: boolean;
  isHost: boolean;
  isActing: boolean;
  purchasedCards: readonly CardDefinition[];
  handCount: number;
}

export interface SelfPlayerView extends PublicPlayerView {
  cash: Money;
  hand: readonly CardDefinition[];
}

export interface AuctionView {
  type: AuctionType;
  cardIds: readonly string[];
  currentPrice?: Money;
  currentBidderId?: string;
  actingPlayerId?: string;
  expiresAt?: string;
  submittedPlayerIds?: readonly string[];
  ownBid?: Money;
  revealedBids?: Readonly<Record<string, Money>>;
  phase?: 'PRICING' | 'OFFERING' | 'CHOOSING_MODE' | 'INVITING' | 'BIDDING';
  fixedPrice?: Money;
  stolen?: boolean;
}

export interface PlayerGameView {
  roomId: string;
  gameId: string;
  stateVersion: number;
  eventSequence: number;
  round: 1 | 2 | 3 | 4;
  hostPlayerId: string;
  self: SelfPlayerView;
  players: readonly PublicPlayerView[];
  seriesCounts: Readonly<Record<CollectionSeries, number>>;
  cumulativeSeriesPrices: Readonly<Record<CollectionSeries, Money>>;
  auction: AuctionView | null;
}
