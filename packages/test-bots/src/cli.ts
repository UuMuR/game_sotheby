import { parseArgs } from 'node:util';

import { simulateGame } from './simulate.ts';

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '3' },
    seed: { type: 'string', default: '20260901' },
  },
});
const playerCount = Number(values.players);
if (![3, 4, 6, 8].includes(playerCount)) throw new Error('--players must be 3, 4, 6, or 8');
const result = simulateGame({
  playerCount: playerCount as 3 | 4 | 6 | 8,
  seed: Number(values.seed),
});
console.log(JSON.stringify({
  status: result.state.status,
  round: result.state.round,
  events: result.eventSequences.length,
  standings: result.standings,
  coverage: result.coverage,
}, null, 2));
