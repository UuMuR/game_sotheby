import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../commands.ts';
import { loadPlaceholderCatalog } from '../catalog.ts';
import { initializeGame } from '../initialize.ts';
import type { GameCommandInput, GameState } from '../model.ts';
import { projectForPlayer } from '../projection.ts';
import { createSeededRandom } from '../random.ts';
import { handleCommand } from '../reducer.ts';

const NOW = new Date('2026-09-01T08:00:00.000Z');

function makeState(stolen: boolean, balances: Record<string, number> = {}): GameState {
  const catalog = loadPlaceholderCatalog();
  const card = catalog.find((candidate) => candidate.auctionType === 'SEALED_BID' && candidate.stolen === stolen);
  if (!card) throw new Error('Missing sealed-bid test card');
  const initial = initializeGame({
    roomId: 'room-1', gameId: 'game-1', catalog, randomSource: createSeededRandom(2),
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
  });
  const players = Object.fromEntries(Object.entries(initial.players).map(([id, player]) => [id, {
    ...player,
    cash: balances[id] ?? player.cash,
    hand: id === 'p1' ? [card] : player.hand.filter((held) => held.id !== card.id),
  }]));
  return { ...initial, players, hostPlayerId: 'p1' };
}

function command<T extends GameCommandInput['type']>(state: GameState, playerId: string, type: T, payload: Extract<GameCommandInput, { type: T }>['payload']): Extract<GameCommandInput, { type: T }> {
  return { requestId: `${type}-${state.stateVersion}-${playerId}`, playerId, stateVersion: state.stateVersion, type, payload } as Extract<GameCommandInput, { type: T }>;
}

function succeed(result: CommandResult) {
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

function play(state: GameState) {
  const cardId = state.players.p1?.hand[0]?.id;
  if (!cardId) throw new Error('Missing host card');
  return succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId }), NOW));
}

describe('normal sealed bid', () => {
  it('keeps bids private until the deadline and resolves high ties by clockwise priority', () => {
    let state = play(makeState(false)).state;
    state = succeed(handleCommand(state, command(state, 'p3', 'SUBMIT_SEALED_BID', { amount: 20 }), new Date('2026-09-01T08:00:05.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p2', 'SUBMIT_SEALED_BID', { amount: 20 }), new Date('2026-09-01T08:00:06.000Z'))).state;

    const p2View = projectForPlayer(state, 'p2');
    const p3View = projectForPlayer(state, 'p3');
    expect(p2View.auction).toMatchObject({ ownBid: 20 });
    expect(p3View.auction).toMatchObject({ ownBid: 20 });
    expect(p2View.auction).not.toHaveProperty('revealedBids');
    expect(JSON.stringify(p2View)).not.toContain('"p3":20');

    const result = succeed(handleCommand(state, command(state, 'p1', 'EXPIRE_AUCTION', {}), new Date('2026-09-01T08:00:30.000Z')));
    expect(result.state.players.p2?.purchasedCards).toHaveLength(1);
    expect(result.state.players.p2?.cash).toBe(130);
    expect(result.state.players.p1?.cash).toBe(170);
    expect(result.events[0]?.payload).toMatchObject({ winnerId: 'p2', bids: { p2: 20, p3: 20 } });
  });
});

describe('stolen sealed bid', () => {
  it('allows zero/debt bidders at zero, chooses the lowest, and charges every loser to the bank', () => {
    let state = play(makeState(true, { p1: 30, p2: -5, p3: 20 })).state;
    state = succeed(handleCommand(state, command(state, 'p2', 'SUBMIT_SEALED_BID', { amount: 0 }), new Date('2026-09-01T08:00:02.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p3', 'SUBMIT_SEALED_BID', { amount: 10 }), new Date('2026-09-01T08:00:03.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p1', 'SUBMIT_SEALED_BID', { amount: 5 }), new Date('2026-09-01T08:00:04.000Z'))).state;

    const result = succeed(handleCommand(state, command(state, 'p1', 'EXPIRE_AUCTION', {}), new Date('2026-09-01T08:00:30.000Z')));
    expect(result.state.players.p2?.purchasedCards).toHaveLength(1);
    expect(result.state.players.p2?.cash).toBe(-5);
    expect(result.state.players.p3?.cash).toBe(10);
    expect(result.state.players.p1?.cash).toBe(25);
    expect(result.events[0]?.payload).toMatchObject({ winnerId: 'p2', bids: { p1: 5, p2: 0, p3: 10 } });
  });

  it('auto-submits zero for missing non-host players and uses clockwise tie priority', () => {
    const started = play(makeState(true));
    const result = succeed(handleCommand(started.state, command(started.state, 'p1', 'EXPIRE_AUCTION', {}), new Date('2026-09-01T08:00:30.000Z')));

    expect(result.state.players.p2?.purchasedCards).toHaveLength(1);
    expect(result.events[0]?.payload).toMatchObject({ winnerId: 'p2', bids: { p2: 0, p3: 0 } });
  });
});
