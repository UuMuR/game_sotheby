import { describe, expect, it } from 'vitest';

import type { CardDefinition } from '@sotheby/contracts';

import type { CommandResult } from '../commands.ts';
import { loadPlaceholderCatalog } from '../catalog.ts';
import { initializeGame } from '../initialize.ts';
import type { GameCommandInput, GameState } from '../model.ts';
import { createSeededRandom } from '../random.ts';
import { handleCommand } from '../reducer.ts';
import { settleJointPurchase, splitJointPrice } from './joint.ts';

const NOW = new Date('2026-09-01T08:00:00.000Z');

function cardsForJoint(): { joint: CardDefinition; second: CardDefinition } {
  const catalog = loadPlaceholderCatalog();
  const joint = catalog.find((card) => card.auctionType === 'JOINT' && !card.stolen);
  if (!joint) throw new Error('Missing joint card');
  const second = catalog.find((card) => card.series === joint.series && card.auctionType === 'OPEN' && !card.stolen);
  if (!second) throw new Error('Missing matching open card');
  return { joint, second };
}

function makeState(balances: Record<string, number> = {}): GameState {
  const catalog = loadPlaceholderCatalog();
  const { joint, second } = cardsForJoint();
  const initial = initializeGame({
    roomId: 'room-1', gameId: 'game-1', catalog, randomSource: createSeededRandom(3),
    players: ['p1', 'p2', 'p3'].map((id) => ({ id, nickname: id, avatarUrl: `/${id}.png` })),
  });
  const players = Object.fromEntries(Object.entries(initial.players).map(([id, player]) => [id, {
    ...player,
    cash: balances[id] ?? player.cash,
    hand: id === 'p1' ? [joint] : id === 'p2' ? [second] : player.hand.filter((card) => card.id !== joint.id && card.id !== second.id),
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

function playJoint(state: GameState) {
  const cardId = state.players.p1?.hand[0]?.id;
  if (!cardId) throw new Error('Missing joint card');
  return succeed(handleCommand(state, command(state, 'p1', 'PLAY_CARD', { cardId }), NOW));
}

describe('joint auctions', () => {
  it('splits odd prices in favor of the old host', () => {
    expect(splitJointPrice(11)).toEqual({ oldHostShare: 6, newHostShare: 5 });
  });

  it('lets the host add a matching non-stolen non-joint card', () => {
    const { second } = cardsForJoint();
    const initial = makeState();
    const host = initial.players.p1!;
    const state = { ...initial, players: { ...initial.players, p1: { ...host, hand: [...host.hand, second] } } };
    const started = playJoint(state);
    const result = succeed(handleCommand(started.state, command(started.state, 'p1', 'CHOOSE_SELF_JOINT_CARD', { cardId: second.id }), new Date('2026-09-01T08:00:01.000Z')));

    expect(result.state.auction).toMatchObject({ type: 'OPEN' });
    expect(result.state.auction?.cards).toHaveLength(2);
    expect(result.state.players.p1?.hand).toHaveLength(0);
  });

  it('gives the initial card to the old host for free when nobody joins', () => {
    let state = playJoint(makeState()).state;
    state = succeed(handleCommand(state, command(state, 'p1', 'INVITE_JOINT_PLAYER', {}), new Date('2026-09-01T08:00:01.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p2', 'RESPOND_JOINT_INVITE', { accept: false }), new Date('2026-09-01T08:00:02.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p3', 'RESPOND_JOINT_INVITE', { accept: false }), new Date('2026-09-01T08:00:03.000Z'))).state;

    expect(state.auction).toBeNull();
    expect(state.players.p1?.purchasedCards).toHaveLength(1);
    expect(state.players.p1?.cash).toBe(150);
    expect(state.hostPlayerId).toBe('p2');
  });

  it('allows a debtor to become new host but not bid, then splits another buyer payment', () => {
    const { second } = cardsForJoint();
    let state = playJoint(makeState({ p2: -10 })).state;
    state = succeed(handleCommand(state, command(state, 'p1', 'INVITE_JOINT_PLAYER', {}), new Date('2026-09-01T08:00:01.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p2', 'RESPOND_JOINT_INVITE', { accept: true, cardId: second.id }), new Date('2026-09-01T08:00:02.000Z'))).state;
    expect(state.hostPlayerId).toBe('p2');
    expect(state.auction).toMatchObject({ type: 'OPEN' });

    const denied = handleCommand(state, command(state, 'p2', 'PLACE_OPEN_BID', { amount: 1 }), new Date('2026-09-01T08:00:03.000Z'));
    expect(denied).toMatchObject({ ok: false, error: { code: 'PLAYER_NOT_ELIGIBLE' } });

    state = succeed(handleCommand(state, command(state, 'p3', 'PLACE_OPEN_BID', { amount: 11 }), new Date('2026-09-01T08:00:04.000Z'))).state;
    state = succeed(handleCommand(state, command(state, 'p1', 'EXPIRE_AUCTION', {}), new Date('2026-09-01T08:00:34.000Z'))).state;
    expect(state.players.p1?.cash).toBe(156);
    expect(state.players.p2?.cash).toBe(-5);
    expect(state.players.p3?.cash).toBe(139);
    expect(state.players.p3?.purchasedCards).toHaveLength(2);
    expect(state.hostPlayerId).toBe('p3');
  });

  it('settles the old-host and new-host buyer cases without charging the waived share', () => {
    const initial = makeState();
    const { joint, second } = cardsForJoint();
    const context = { kind: 'JOINT_PARTNER' as const, oldHostId: 'p1', newHostId: 'p2' };

    const oldBuys = settleJointPurchase(initial, context, 'p1', 11, [joint, second]);
    expect(oldBuys.state.players.p1?.cash).toBe(139);
    expect(oldBuys.state.players.p2?.cash).toBe(155);

    const newBuys = settleJointPurchase(initial, context, 'p2', 11, [joint, second]);
    expect(newBuys.state.players.p1?.cash).toBe(156);
    expect(newBuys.state.players.p2?.cash).toBe(144);
  });
});
