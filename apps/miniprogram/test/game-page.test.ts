import { describe, expect, it } from 'vitest';

import type { PlayerGameView } from '@sotheby/contracts';

import { resolveCardImage } from '../miniprogram/services/asset-resolver.ts';
import { createGamePageModel, remainingSeconds } from '../miniprogram/pages/game/view-model.ts';

function view(cash = 50): PlayerGameView {
  return {
    roomId: 'room-1', gameId: 'game-1', stateVersion: 2, eventSequence: 1,
    round: 2, hostPlayerId: 'p1',
    self: { id: 'p2', nickname: 'P2', avatarUrl: '/2.png', seat: 1, online: true, isHost: false, isActing: false, purchasedCards: [], handCount: 1, cash, hand: [] },
    players: [
      { id: 'p1', nickname: 'P1', avatarUrl: '/1.png', seat: 0, online: true, isHost: true, isActing: false, purchasedCards: [], handCount: 2 },
      { id: 'p2', nickname: 'P2', avatarUrl: '/2.png', seat: 1, online: true, isHost: false, isActing: false, purchasedCards: [], handCount: 1 },
    ],
    seriesCounts: { BLACK: 1, BLUE: 2, GREEN: 3, YELLOW: 4, RED: 5 },
    cumulativeSeriesPrices: { BLACK: 30, BLUE: 20, GREEN: 10, YELLOW: 0, RED: 0 },
    auction: { type: 'OPEN', cardIds: ['BL-001'], currentPrice: 10, currentBidderId: 'p1', expiresAt: '2026-09-01T08:00:30.000Z' },
  };
}

describe('game page model', () => {
  it('derives the server-authoritative countdown and open bid controls', () => {
    expect(remainingSeconds('2026-09-01T08:00:30.000Z', new Date('2026-09-01T08:00:12.200Z'))).toBe(18);
    const model = createGamePageModel(view(), new Date('2026-09-01T08:00:12.200Z'));
    expect(model.roundLabel).toBe('第 2 / 4 阶段');
    expect(model.remainingSeconds).toBe(18);
    expect(model.actions).toContainEqual(expect.objectContaining({ type: 'PLACE_OPEN_BID', minimumAmount: 11, enabled: true }));
  });

  it('disables ordinary bidding for zero or indebted players', () => {
    expect(createGamePageModel(view(0), new Date()).actions.every((action) => !action.enabled)).toBe(true);
    expect(createGamePageModel(view(-10), new Date()).actions.every((action) => !action.enabled)).toBe(true);
  });
});

describe('asset resolver', () => {
  it('uses local placeholders until the CDN base is configured', () => {
    expect(resolveCardImage('BL-001', 'BLUE')).toBe('/assets/placeholders/blue.svg');
  });
});

describe('auction action models', () => {
  it('shows fixed-price decisions only to the acting eligible player', () => {
    const model = createGamePageModel({
      ...view(),
      auction: { type: 'FIXED_PRICE', cardIds: ['YL-001'], fixedPrice: 20, actingPlayerId: 'p2', phase: 'OFFERING', expiresAt: '2026-09-01T08:00:30.000Z' },
    }, new Date('2026-09-01T08:00:10.000Z'));
    expect(model.actions.map((action) => action.type)).toEqual(['ACCEPT_FIXED_PRICE', 'DECLINE_FIXED_PRICE']);
  });

  it('shows sequential bid and pass only on the current player turn', () => {
    const model = createGamePageModel({
      ...view(),
      auction: { type: 'SEQUENTIAL', cardIds: ['GR-001'], currentPrice: 12, actingPlayerId: 'p2', phase: 'BIDDING', expiresAt: '2026-09-01T08:00:30.000Z' },
    }, new Date('2026-09-01T08:00:10.000Z'));
    expect(model.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PLACE_SEQUENTIAL_BID', minimumAmount: 13, enabled: true }),
      expect.objectContaining({ type: 'PASS_SEQUENTIAL', enabled: true }),
    ]));
  });

  it('allows a zero-cash player to submit zero only for a stolen sealed bid', () => {
    const normal = createGamePageModel({
      ...view(0),
      auction: { type: 'SEALED_BID', cardIds: ['BK-001'], stolen: false, submittedPlayerIds: [], expiresAt: '2026-09-01T08:00:30.000Z' },
    }, new Date('2026-09-01T08:00:10.000Z'));
    const stolen = createGamePageModel({
      ...view(0),
      auction: { type: 'SEALED_BID', cardIds: ['BK-004'], stolen: true, submittedPlayerIds: [], expiresAt: '2026-09-01T08:00:30.000Z' },
    }, new Date('2026-09-01T08:00:10.000Z'));
    expect(normal.actions.every((action) => !action.enabled)).toBe(true);
    expect(stolen.actions).toContainEqual(expect.objectContaining({ type: 'SUBMIT_SEALED_BID', minimumAmount: 0, enabled: true }));
  });

  it('shows joint mode choices to the host and invitation response to the invited player', () => {
    const choosing = createGamePageModel({
      ...view(), self: { ...view().self, id: 'p1', isHost: true }, hostPlayerId: 'p1',
      auction: { type: 'JOINT', cardIds: ['BL-010'], phase: 'CHOOSING_MODE', actingPlayerId: 'p1' },
    }, new Date());
    expect(choosing.actions.map((action) => action.type)).toEqual(['CHOOSE_SELF_JOINT_CARD', 'INVITE_JOINT_PLAYER']);

    const invited = createGamePageModel({
      ...view(), auction: { type: 'JOINT', cardIds: ['BL-010'], phase: 'INVITING', actingPlayerId: 'p2', expiresAt: '2026-09-01T08:00:30.000Z' },
    }, new Date('2026-09-01T08:00:10.000Z'));
    expect(invited.actions.map((action) => action.type)).toEqual(['ACCEPT_JOINT_INVITE', 'DECLINE_JOINT_INVITE']);
  });
});
