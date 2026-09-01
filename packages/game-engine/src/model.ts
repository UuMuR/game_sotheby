import type { CardDefinition, CollectionSeries, Money } from '@sotheby/contracts';

import type { GameCommandInput } from './commands.ts';

export type GameStatus = 'IN_PROGRESS' | 'ROUND_SETTLEMENT' | 'FINISHED';
export type RoundNumber = 1 | 2 | 3 | 4;

export interface PlayerIdentity {
  id: string;
  nickname: string;
  avatarUrl: string;
}

export interface PlayerState extends PlayerIdentity {
  seat: number;
  online: boolean;
  cash: Money;
  hand: readonly CardDefinition[];
  purchasedCards: readonly CardDefinition[];
}

export interface StandardSettlementContext {
  kind: 'STANDARD';
  sellerId: string;
  nextHostBaseId: string;
}

export interface JointSelfContext {
  kind: 'JOINT_SELF';
  oldHostId: string;
}

export interface JointPartnerContext {
  kind: 'JOINT_PARTNER';
  oldHostId: string;
  newHostId: string;
}

export type AuctionSettlementContext = StandardSettlementContext | JointSelfContext | JointPartnerContext;

export interface OpenAuctionState {
  type: 'OPEN';
  cards: readonly CardDefinition[];
  settlement: AuctionSettlementContext;
  currentPrice: Money;
  currentBidderId?: string;
  expiresAt: string;
}

export interface FixedPriceAuctionState {
  type: 'FIXED_PRICE';
  cards: readonly CardDefinition[];
  settlement: AuctionSettlementContext;
  phase: 'PRICING' | 'OFFERING';
  fixedPrice?: Money;
  actingPlayerId: string;
  expiresAt: string;
}

export interface SequentialAuctionState {
  type: 'SEQUENTIAL';
  cards: readonly CardDefinition[];
  settlement: AuctionSettlementContext;
  currentPrice: Money;
  currentBidderId?: string;
  actingPlayerId: string;
  actedPlayerIds: readonly string[];
  expiresAt: string;
}

export interface SealedBidAuctionState {
  type: 'SEALED_BID';
  cards: readonly CardDefinition[];
  settlement: AuctionSettlementContext;
  stolen: boolean;
  bids: Readonly<Record<string, Money>>;
  expiresAt: string;
  revealed: boolean;
}

export interface JointAuctionState {
  type: 'JOINT';
  cards: readonly CardDefinition[];
  oldHostId: string;
  phase: 'CHOOSING_MODE' | 'INVITING';
  actingPlayerId: string;
  invitedPlayerIds: readonly string[];
  expiresAt?: string;
}

export type ActiveAuctionState =
  | OpenAuctionState
  | FixedPriceAuctionState
  | SequentialAuctionState
  | SealedBidAuctionState
  | JointAuctionState;

export interface GameState {
  roomId: string;
  gameId: string;
  rulesVersion: string;
  status: GameStatus;
  round: RoundNumber;
  players: Readonly<Record<string, PlayerState>>;
  seatOrder: readonly string[];
  deck: readonly CardDefinition[];
  discardedCards: readonly CardDefinition[];
  hostPlayerId: string;
  auction: ActiveAuctionState | null;
  seriesCounts: Readonly<Record<CollectionSeries, number>>;
  cumulativeSeriesPrices: Readonly<Record<CollectionSeries, Money>>;
  stateVersion: number;
  eventSequence: number;
  roundEndHostPlayerId?: string;
}

export interface InitializeGameInput {
  roomId: string;
  gameId: string;
  players: readonly PlayerIdentity[];
  catalog: readonly CardDefinition[];
  randomSource: RandomSource;
  rulesVersion?: string;
}

export interface RandomSource {
  next(): number;
  shuffle<T>(values: readonly T[]): T[];
  integer(maxExclusive: number): number;
}

export type { GameCommandInput };
