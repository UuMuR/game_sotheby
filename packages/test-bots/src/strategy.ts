import type { CardDefinition } from '@sotheby/contracts';
import type { GameState, JointAuctionState } from '@sotheby/game-engine';

export function chooseHostCard(
  state: GameState,
  coveredTypes: ReadonlySet<CardDefinition['auctionType']>,
): CardDefinition {
  const host = state.players[state.hostPlayerId];
  if (!host || host.hand.length === 0) throw new Error('Host has no playable card');

  const uncovered = host.hand.find((card) => !coveredTypes.has(card.auctionType));
  return uncovered ?? host.hand[0]!;
}

export function findJointCompanion(
  state: GameState,
  auction: JointAuctionState,
  playerId: string,
): CardDefinition | undefined {
  const initial = auction.cards[0];
  const player = state.players[playerId];
  if (!initial || !player) return undefined;
  return player.hand.find(
    (card) =>
      card.series === initial.series &&
      !card.stolen &&
      card.auctionType !== 'JOINT',
  );
}

export function affordableBid(state: GameState, playerId: string, minimum: number): number | null {
  const cash = state.players[playerId]?.cash ?? 0;
  return cash >= minimum ? minimum : null;
}
