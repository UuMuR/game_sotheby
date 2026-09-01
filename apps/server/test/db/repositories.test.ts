import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GameState } from '@sotheby/game-engine';

import { gameEvents, gameSnapshots, rooms } from '../../src/db/schema.ts';
import {
  InMemoryGameRepository,
  type AppendEventsAndSnapshotInput,
} from '../../src/db/repositories/game-repository.ts';
import { InMemoryIdempotencyRepository } from '../../src/db/repositories/idempotency-repository.ts';

const minimalState = (version: number, sequence: number): GameState => ({
  roomId: 'room-1',
  gameId: 'game-1',
  rulesVersion: '1.0.0',
  status: 'IN_PROGRESS',
  round: 1,
  players: {},
  seatOrder: [],
  deck: [],
  discardedCards: [],
  hostPlayerId: 'p1',
  auction: null,
  seriesCounts: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 },
  cumulativeSeriesPrices: { BLACK: 0, BLUE: 0, GREEN: 0, YELLOW: 0, RED: 0 },
  stateVersion: version,
  eventSequence: sequence,
});

function appendInput(version: number, sequence: number): AppendEventsAndSnapshotInput {
  return {
    gameId: 'game-1',
    expectedStateVersion: version - 1,
    nextState: minimalState(version, sequence),
    events: [
      {
        eventId: `event-${sequence}`,
        sequence,
        gameId: 'game-1',
        roomId: 'room-1',
        actorPlayerId: 'p1',
        occurredAt: '2026-09-01T08:00:00.000Z',
        rulesVersion: '1.0.0',
        type: 'TEST_EVENT',
        payload: { sequence },
      },
    ],
    writeSnapshot: true,
  };
}

describe('database schema and migration', () => {
  it('defines the core room, event, and snapshot tables', () => {
    expect(rooms).toBeDefined();
    expect(gameEvents).toBeDefined();
    expect(gameSnapshots).toBeDefined();

    const migration = readFileSync(
      fileURLToPath(new URL('../../src/db/migrations/0001_initial.sql', import.meta.url)),
      'utf8',
    );
    expect(migration).toMatch(/UNIQUE KEY `rooms_code_unique` \(`code`\)/);
    expect(migration).toMatch(/UNIQUE KEY `game_events_game_sequence_unique` \(`game_id`, `sequence`\)/);
    expect(migration).toMatch(/UNIQUE KEY `command_results_request_unique` \(`request_id`\)/);
  });
});

describe('game repository transaction semantics', () => {
  it('appends events and a snapshot when the expected version matches', async () => {
    const repository = new InMemoryGameRepository();
    repository.seedSnapshot(minimalState(1, 0));

    const stored = await repository.appendEventsAndSnapshot(appendInput(2, 1));

    expect(stored.stateVersion).toBe(2);
    expect(stored.eventSequence).toBe(1);
    expect((await repository.loadGameForRecovery('game-1')).snapshot).toEqual(minimalState(2, 1));
  });

  it('rejects stale state and duplicate event sequences without partial writes', async () => {
    const repository = new InMemoryGameRepository();
    repository.seedSnapshot(minimalState(2, 1));

    await expect(repository.appendEventsAndSnapshot(appendInput(3, 1))).rejects.toThrow(/sequence/i);
    await expect(repository.appendEventsAndSnapshot(appendInput(4, 2))).rejects.toThrow(/state version/i);

    const recovered = await repository.loadGameForRecovery('game-1');
    expect(recovered.snapshot).toEqual(minimalState(2, 1));
    expect(recovered.eventsAfterSnapshot).toEqual([]);
  });

  it('returns recovery events ordered after the latest snapshot', async () => {
    const repository = new InMemoryGameRepository();
    repository.seedSnapshot(minimalState(2, 1));
    repository.seedEvent({ ...appendInput(4, 3).events[0]!, sequence: 3 });
    repository.seedEvent({ ...appendInput(3, 2).events[0]!, sequence: 2 });

    const recovered = await repository.loadGameForRecovery('game-1');

    expect(recovered.snapshot?.stateVersion).toBe(2);
    expect(recovered.eventsAfterSnapshot.map((event) => event.sequence)).toEqual([2, 3]);
  });
});

describe('idempotency repository', () => {
  it('stores one result per request id and returns the original result', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const original = { ok: true, stateVersion: 4 } as const;

    await repository.saveCommandResult('request-1', 'game-1', original);
    await repository.saveCommandResult('request-1', 'game-1', { ok: true, stateVersion: 99 });

    expect(await repository.findCommandResult('request-1')).toEqual(original);
  });
});
