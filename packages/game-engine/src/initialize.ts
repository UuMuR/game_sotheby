import type { CollectionSeries } from '@sotheby/contracts';

import type { GameState, InitializeGameInput, PlayerState } from './model.ts';

const INITIAL_HAND_SIZE: Readonly<Record<number, number>> = {
  3: 11,
  4: 10,
  5: 10,
  6: 8,
  7: 8,
  8: 6,
};

function emptySeriesRecord(): Record<CollectionSeries, number> {
  return { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 };
}

function validatePlayers(input: InitializeGameInput): void {
  if (input.players.length < 3 || input.players.length > 8) {
    throw new Error('A game requires between 3 and 8 players');
  }

  const ids = input.players.map((player) => player.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Player ids must be unique');
  }

  if (input.roomId.length === 0 || input.gameId.length === 0) {
    throw new Error('roomId and gameId are required');
  }
}

export function initializeGame(input: InitializeGameInput): GameState {
  validatePlayers(input);

  const handSize = INITIAL_HAND_SIZE[input.players.length];
  if (handSize === undefined) {
    throw new Error('A game requires between 3 and 8 players');
  }

  const requiredCards = handSize * input.players.length;
  if (input.catalog.length < requiredCards) {
    throw new Error(`Catalog requires at least ${requiredCards} cards`);
  }

  const shuffledDeck = input.randomSource.shuffle(input.catalog);
  const players: Record<string, PlayerState> = {};
  let cursor = 0;

  input.players.forEach((identity, seat) => {
    const hand = shuffledDeck.slice(cursor, cursor + handSize);
    cursor += handSize;
    players[identity.id] = {
      ...identity,
      seat,
      online: true,
      cash: 150,
      hand,
      purchasedCards: [],
    };
  });

  const seatOrder = input.players.map((player) => player.id);
  const hostPlayerId = seatOrder[input.randomSource.integer(seatOrder.length)];
  if (hostPlayerId === undefined) {
    throw new Error('Cannot choose a host from an empty seat order');
  }

  return {
    roomId: input.roomId,
    gameId: input.gameId,
    rulesVersion: input.rulesVersion ?? '1.0.0',
    status: 'IN_PROGRESS',
    round: 1,
    players,
    seatOrder,
    deck: shuffledDeck.slice(cursor),
    discardedCards: [],
    hostPlayerId,
    auction: null,
    seriesCounts: emptySeriesRecord(),
    cumulativeSeriesPrices: emptySeriesRecord(),
    stateVersion: 1,
    eventSequence: 0,
  };
}
