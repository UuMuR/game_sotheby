import { describe, expect, it } from 'vitest';

import type { CardDefinition } from '@sotheby/contracts';

import { loadPlaceholderCatalog } from '../catalog.ts';
import { handleCommand } from '../reducer.ts';
import { initializeGame } from '../initialize.ts';
import type { CommandResult } from '../commands.ts';
import type { GameCommandInput, GameState } from '../model.ts';
import { createSeededRandom } from '../random.ts';

const NOW = new Date('2026-09-01T08:00:00.000Z');

function makeState(type: CardDefinition['auctionType'], balances: Record<string, number> = {}): GameState {
  const catalog = loadPlaceholderCatalog();
  const card = catalog.find((candidate) => candidate.auctionType === type && !candidate.stolen);
  if (!card) throw new Error(`Missing ${type} test card`);

  const initial = initializeGame({
    roomId: 'room-1',
    gameId: 'game-1',
    players: [
      { id: 'p1', nickname: 'P1', avatarUrl: '/1.png' },
      { id: 'p2', nickname: 'P2', avatarUrl: '/2.png' },
      { id: 'p3', nickname: 'P3', avatarUrl: '/3.png' },
    ],
    catalog,
    randomSource: createSeededRandom(1),
  });

  const players = Object.fromEntries(
    Object.entries(initial.players).map(([id, player]) => [
      id,
      {
        ...player,
        cash: balances[id] ?? player.cash,
        hand: id === 'p1' ? [card] : player.hand.filter((held) => held.id !== card.id),
      },
    ]),
  );

  return { ...initial, players, hostPlayerId: 'p1' };
}

function command<T extends GameCommandInput['type']>(
  state: GameState,
  playerId: string,
  type: T,
  payload: Extract<GameCommandInput, { type: T }>['payload'],
): Extract<GameCommandInput, { type: T }> {
  return {
    requestId: `${type}-${state.stateVersion}-${playerId}`,
    playerId,
    stateVersion: state.stateVersion,
    type,
    payload,
  } as Extract<GameCommandInput, { type: T }>;
}


function mustSucceed(result: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

function play(state: GameState): Extract<CommandResult, { ok: true }> {
  const cardId = state.players.p1?.hand[0]?.id;
  if (!cardId) throw new Error('Host has no test card');
  const result = handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId }), NOW);
  if (!result.ok) throw new Error(result.error.code);
  return result;
}

describe('public auction', () => {
  it('starts at zero with a 30 second server deadline', () => {
    const result = play(makeState('OPEN'));

    expect(result.state.auction).toMatchObject({ type: 'OPEN', currentPrice: 0 });
    expect(result.state.auction?.expiresAt).toBe('2026-09-01T08:00:30.000Z');
  });

  it('accepts increasing affordable bids and resets the deadline', () => {
    const started = play(makeState('OPEN'));
    const bid = handleCommand(
      started.state,
      command(started.state, 'p2', 'PLACE_OPEN_BID', { amount: 41 }),
      new Date('2026-09-01T08:00:10.000Z'),
    );

    expect(bid.ok).toBe(true);
    if (!bid.ok) return;
    expect(bid.state.auction).toMatchObject({ currentPrice: 41, currentBidderId: 'p2' });
    expect(bid.state.auction?.expiresAt).toBe('2026-09-01T08:00:40.000Z');
  });

  it('rejects invalid increments, insufficient cash, and expired bids without mutation', () => {
    const started = play(makeState('OPEN', { p2: 5 }));
    const first = handleCommand(
      started.state,
      command(started.state, 'p3', 'PLACE_OPEN_BID', { amount: 5 }),
      new Date('2026-09-01T08:00:01.000Z'),
    );
    if (!first.ok) throw new Error(first.error.code);

    for (const [amount, time, code] of [
      [5, '2026-09-01T08:00:02.000Z', 'INVALID_INCREMENT'],
      [6, '2026-09-01T08:00:02.000Z', 'INSUFFICIENT_CASH'],
      [6, '2026-09-01T08:00:31.000Z', 'AUCTION_EXPIRED'],
    ] as const) {
      const result = handleCommand(
        first.state,
        command(first.state, 'p2', 'PLACE_OPEN_BID', { amount }),
        new Date(time),
      );
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(result.state).toBe(first.state);
    }
  });

  it('settles to the highest bidder or gives an unbid lot to the host for zero', () => {
    const started = play(makeState('OPEN'));
    const bid = handleCommand(
      started.state,
      command(started.state, 'p2', 'PLACE_OPEN_BID', { amount: 40 }),
      new Date('2026-09-01T08:00:01.000Z'),
    );
    if (!bid.ok) throw new Error(bid.error.code);
    const sold = handleCommand(
      bid.state,
      command(bid.state, 'p1', 'EXPIRE_AUCTION', {}),
      new Date('2026-09-01T08:00:31.000Z'),
    );
    expect(sold.ok).toBe(true);
    if (!sold.ok) return;
    expect(sold.state.players.p2?.cash).toBe(110);
    expect(sold.state.players.p1?.cash).toBe(190);
    expect(sold.state.players.p2?.purchasedCards).toHaveLength(1);
    expect(sold.state.hostPlayerId).toBe('p2');

    const unbid = play(makeState('OPEN'));
    const expired = handleCommand(
      unbid.state,
      command(unbid.state, 'p1', 'EXPIRE_AUCTION', {}),
      new Date('2026-09-01T08:00:31.000Z'),
    );
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.state.players.p1?.cash).toBe(150);
    expect(expired.state.players.p1?.purchasedCards).toHaveLength(1);
  });
});

describe('fixed price auction', () => {
  it('defaults the host price to zero after 60 seconds', () => {
    const started = play(makeState('FIXED_PRICE'));
    const expired = handleCommand(
      started.state,
      command(started.state, 'p1', 'EXPIRE_AUCTION', {}),
      new Date('2026-09-01T08:01:00.000Z'),
    );

    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    expect(expired.state.auction).toMatchObject({
      type: 'FIXED_PRICE',
      phase: 'OFFERING',
      fixedPrice: 0,
      actingPlayerId: 'p2',
    });
  });

  it('sells to the first accepting player and otherwise returns to the host', () => {
    let state = play(makeState('FIXED_PRICE')).state;
    state = mustSucceed(handleCommand(
      state,
      command(state, 'p1', 'SET_FIXED_PRICE', { amount: 25 }),
      new Date('2026-09-01T08:00:05.000Z'),
    )).state;
    state = mustSucceed(handleCommand(
      state,
      command(state, 'p2', 'RESPOND_FIXED_PRICE', { accept: false }),
      new Date('2026-09-01T08:00:06.000Z'),
    )).state;
    state = mustSucceed(handleCommand(
      state,
      command(state, 'p3', 'RESPOND_FIXED_PRICE', { accept: true }),
      new Date('2026-09-01T08:00:07.000Z'),
    )).state;
    expect(state.players.p3?.cash).toBe(125);
    expect(state.players.p1?.cash).toBe(175);
    expect(state.players.p3?.purchasedCards).toHaveLength(1);
  });

  it('forces a zero or indebted host to set price zero and skips ineligible buyers', () => {
    const started = play(makeState('FIXED_PRICE', { p1: -20, p2: 0, p3: 10 }));
    const invalid = handleCommand(
      started.state,
      command(started.state, 'p1', 'SET_FIXED_PRICE', { amount: 1 }),
      new Date('2026-09-01T08:00:01.000Z'),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_CASH' } });

    const priced = mustSucceed(handleCommand(
      started.state,
      command(started.state, 'p1', 'SET_FIXED_PRICE', { amount: 0 }),
      new Date('2026-09-01T08:00:02.000Z'),
    ));
    expect(priced.state.auction).toMatchObject({ actingPlayerId: 'p3' });
  });
});

describe('sequential auction', () => {
  it('runs clockwise once, treats timeout as pass, and resolves after the host', () => {
    let state = play(makeState('SEQUENTIAL')).state;
    expect(state.auction).toMatchObject({ actingPlayerId: 'p2', currentPrice: 0 });

    state = mustSucceed(handleCommand(
      state,
      command(state, 'p2', 'PLACE_SEQUENTIAL_BID', { amount: 10 }),
      new Date('2026-09-01T08:00:01.000Z'),
    )).state;
    expect(state.auction).toMatchObject({ actingPlayerId: 'p3', currentPrice: 10 });

    state = mustSucceed(handleCommand(
      state,
      command(state, 'p3', 'EXPIRE_AUCTION', {}),
      new Date('2026-09-01T08:00:31.000Z'),
    )).state;
    expect(state.auction).toMatchObject({ actingPlayerId: 'p1', currentPrice: 10 });

    state = mustSucceed(handleCommand(
      state,
      command(state, 'p1', 'PASS_SEQUENTIAL', {}),
      new Date('2026-09-01T08:00:32.000Z'),
    )).state;
    expect(state.auction).toBeNull();
    expect(state.players.p2?.cash).toBe(140);
    expect(state.players.p1?.cash).toBe(160);
    expect(state.players.p2?.purchasedCards).toHaveLength(1);
  });

  it('gives the lot to the host for zero when every player passes', () => {
    let state = play(makeState('SEQUENTIAL')).state;
    for (const playerId of ['p2', 'p3', 'p1']) {
      state = mustSucceed(handleCommand(
        state,
        command(state, playerId, 'PASS_SEQUENTIAL', {}),
        new Date(NOW.getTime() + state.stateVersion * 1000),
      )).state;
    }

    expect(state.players.p1?.purchasedCards).toHaveLength(1);
    expect(state.players.p1?.cash).toBe(150);
  });
});
