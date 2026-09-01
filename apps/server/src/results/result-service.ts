export interface PublicRoundSummary {
  round: 1 | 2 | 3 | 4;
  rankings: readonly {
    series: 'BLACK' | 'BLUE' | 'GREEN' | 'YELLOW' | 'RED';
    count: number;
    addedPrice: number;
    cumulativePrice: number;
  }[];
}

export interface PrivateLedgerItem {
  reason: 'COLLECTION_SALE' | 'STOLEN_FINE';
  delta: number;
  cardId?: string;
  cardName?: string;
  before?: number;
  after?: number;
}

export interface StoredGameResult {
  gameId: string;
  roomCode: string;
  finishedAt: string;
  playerIds: readonly string[];
  finalStandings: readonly {
    playerId: string;
    nickname: string;
    cash: number;
    place: number;
    winner: boolean;
  }[];
  publicRoundSummaries: readonly PublicRoundSummary[];
  privateLedgers: Readonly<Record<string, readonly PrivateLedgerItem[]>>;
}

export interface ResultStore {
  save(result: StoredGameResult): void;
  get(gameId: string): StoredGameResult | null;
  listForPlayer(playerId: string): readonly StoredGameResult[];
}

export class InMemoryResultStore implements ResultStore {
  private readonly results = new Map<string, StoredGameResult>();

  save(result: StoredGameResult): void {
    this.results.set(result.gameId, structuredClone(result));
  }

  get(gameId: string): StoredGameResult | null {
    return structuredClone(this.results.get(gameId) ?? null);
  }

  listForPlayer(playerId: string): readonly StoredGameResult[] {
    return [...this.results.values()]
      .filter((result) => result.playerIds.includes(playerId))
      .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt))
      .map((result) => structuredClone(result));
  }
}

export class ResultService {
  constructor(private readonly store: ResultStore) {}

  getForPlayer(gameId: string, playerId: string) {
    const result = this.store.get(gameId);
    if (!result) throw new Error('GAME_RESULT_NOT_FOUND');
    if (!result.playerIds.includes(playerId)) throw new Error('GAME_RESULT_FORBIDDEN');
    return {
      gameId: result.gameId,
      roomCode: result.roomCode,
      finishedAt: result.finishedAt,
      finalStandings: result.finalStandings,
      publicRoundSummaries: result.publicRoundSummaries,
      privateLedger: result.privateLedgers[playerId] ?? [],
    };
  }

  listForPlayer(playerId: string) {
    return this.store.listForPlayer(playerId).map((result) => {
      const standing = result.finalStandings.find((item) => item.playerId === playerId);
      if (!standing) throw new Error(`Result ${result.gameId} is missing player ${playerId}`);
      return {
        gameId: result.gameId,
        roomCode: result.roomCode,
        finishedAt: result.finishedAt,
        playerCount: result.playerIds.length,
        cash: standing.cash,
        place: standing.place,
        winner: standing.winner,
      };
    });
  }
}
