import type { CardDefinition, CollectionSeries, Money } from '@sotheby/contracts';

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

export interface ActiveAuctionState {
  type: CardDefinition['auctionType'];
  cardIds: readonly string[];
  actingPlayerId?: string;
  currentPrice?: Money;
  currentBidderId?: string;
  expiresAt?: string;
  bids?: Readonly<Record<string, Money>>;
  revealed?: boolean;
}

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
