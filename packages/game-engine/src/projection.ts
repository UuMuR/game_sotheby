import type { AuctionView, PlayerGameView, PublicPlayerView, SelfPlayerView } from '@sotheby/contracts';

import type { ActiveAuctionState, GameState, PlayerState } from './model.ts';

function publicPlayer(state: GameState, player: PlayerState): PublicPlayerView {
  return {
    id: player.id,
    nickname: player.nickname,
    avatarUrl: player.avatarUrl,
    seat: player.seat,
    online: player.online,
    isHost: player.id === state.hostPlayerId,
    isActing:
      state.auction !== null &&
      'actingPlayerId' in state.auction &&
      player.id === state.auction.actingPlayerId,
    purchasedCards: player.purchasedCards,
    handCount: player.hand.length,
  };
}

function selfPlayer(state: GameState, player: PlayerState): SelfPlayerView {
  return {
    ...publicPlayer(state, player),
    cash: player.cash,
    hand: player.hand,
  };
}

function projectAuction(auction: ActiveAuctionState | null, playerId: string): AuctionView | null {
  if (auction === null) return null;

  const view: AuctionView = {
    type: auction.type,
    cardIds: auction.cards.map((card) => card.id),
  };
  if ('actingPlayerId' in auction && auction.actingPlayerId !== undefined) view.actingPlayerId = auction.actingPlayerId;
  if ('currentPrice' in auction) view.currentPrice = auction.currentPrice;
  if ('currentBidderId' in auction && auction.currentBidderId !== undefined) view.currentBidderId = auction.currentBidderId;
  if ('expiresAt' in auction && auction.expiresAt !== undefined) view.expiresAt = auction.expiresAt;
  if (auction.type === 'FIXED_PRICE') {
    view.phase = auction.phase;
    if (auction.fixedPrice !== undefined) view.fixedPrice = auction.fixedPrice;
  }
  if (auction.type === 'SEQUENTIAL') view.phase = 'BIDDING';
  if (auction.type === 'JOINT') view.phase = auction.phase;
  if (auction.type === 'SEALED_BID') {
    view.stolen = auction.stolen;
    view.submittedPlayerIds = Object.keys(auction.bids);
    const ownBid = auction.bids[playerId];
    if (ownBid !== undefined) view.ownBid = ownBid;
    if (auction.revealed) view.revealedBids = auction.bids;
  }
  return view;
}

export function projectForPlayer(state: GameState, playerId: string): PlayerGameView {
  const player = state.players[playerId];
  if (player === undefined) {
    throw new Error(`Player ${playerId} is not part of game ${state.gameId}`);
  }

  return {
    roomId: state.roomId,
    gameId: state.gameId,
    status: state.status,
    stateVersion: state.stateVersion,
    eventSequence: state.eventSequence,
    round: state.round,
    hostPlayerId: state.hostPlayerId,
    self: selfPlayer(state, player),
    players: state.seatOrder.map((id) => {
      const seatedPlayer = state.players[id];
      if (seatedPlayer === undefined) {
        throw new Error(`Seat references missing player ${id}`);
      }
      return publicPlayer(state, seatedPlayer);
    }),
    seriesCounts: state.seriesCounts,
    cumulativeSeriesPrices: state.cumulativeSeriesPrices,
    auction: projectAuction(state.auction, playerId),
    ...(state.lastRoundSettlement === undefined
      ? {}
      : {
          lastRoundSettlement: {
            ...state.lastRoundSettlement,
            ledger: state.lastRoundSettlement.ledger.filter((entry) => entry.playerId === playerId),
          },
        }),
    ...(state.finalStandings === undefined ? {} : { finalStandings: state.finalStandings }),
  };
}
