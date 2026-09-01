import { describe, expect, it } from 'vitest';

import { simulateGame } from './simulate.ts';

function expectCompleteSimulation(playerCount: 3 | 4 | 6 | 8): void {
  const result = simulateGame({ playerCount, seed: 20260901 + playerCount });

  expect(result.state.status).toBe('FINISHED');
  expect(result.state.round).toBe(4);
  expect(result.standings.some((standing) => standing.winner)).toBe(true);
  expect(result.eventSequences).toEqual(
    Array.from({ length: result.eventSequences.length }, (_, index) => index + 1),
  );
  expect(result.stateVersions.every((version, index, versions) => index === 0 || version > versions[index - 1]!)).toBe(true);
  expect(result.uniqueCardLocations).toBe(true);
  expect(result.privateViewsSafe).toBe(true);
}

describe('seeded full-game simulation', () => {
  it('finishes a 3-player game', () => expectCompleteSimulation(3));
  it('finishes a 4-player game', () => expectCompleteSimulation(4));
  it('finishes a 6-player game', () => expectCompleteSimulation(6));
  it('finishes an 8-player game', () => expectCompleteSimulation(8));

  it('is deterministic for the same seed', () => {
    expect(simulateGame({ playerCount: 4, seed: 42 })).toEqual(
      simulateGame({ playerCount: 4, seed: 42 }),
    );
  });

  it('covers every auction type plus stolen bids, joint auctions, timeouts, and debt', () => {
    const result = simulateGame({ playerCount: 8, seed: 20260909 });

    expect(result.coverage.auctionTypes).toEqual(
      expect.arrayContaining(['OPEN', 'SEQUENTIAL', 'FIXED_PRICE', 'JOINT', 'SEALED_BID']),
    );
    expect(result.coverage.stolenSealedBid).toBe(true);
    expect(result.coverage.jointPartnerAuction).toBe(true);
    expect(result.coverage.timeout).toBe(true);
    expect(result.coverage.negativeBalance).toBe(true);
  });
});
