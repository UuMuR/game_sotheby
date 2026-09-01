import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { URL } from 'node:url';

const root = new URL('../', import.meta.url);
const commands = [
  ['node_modules/.bin/eslint', ['apps', 'packages', 'scripts']],
  ['node_modules/.bin/tsc', ['--noEmit', '-p', 'packages/contracts/tsconfig.json']],
  ['node_modules/.bin/tsc', ['--noEmit', '-p', 'packages/game-engine/tsconfig.json']],
  ['node_modules/.bin/tsc', ['--noEmit', '-p', 'packages/test-bots/tsconfig.json']],
  ['node_modules/.bin/tsc', ['--noEmit', '-p', 'apps/server/tsconfig.json']],
  ['node_modules/.bin/tsc', ['--noEmit', '-p', 'apps/miniprogram/tsconfig.json']],
  ['node_modules/.bin/vitest', ['run']],
  ['node', ['--experimental-strip-types', 'scripts/validate-catalog.ts']],
  ['node_modules/.bin/esbuild', [
    'apps/server/src/server.ts', '--bundle', '--platform=node', '--format=esm', '--target=node22',
    '--outfile=apps/server/dist/server.js', '--external:fastify', '--external:@fastify/websocket',
    '--external:ioredis', '--external:mysql2', '--external:mysql2/*', '--external:drizzle-orm',
    '--external:drizzle-orm/*', '--external:ws', '--external:zod',
  ]],
];


const appConfig = JSON.parse(await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../apps/miniprogram/miniprogram/app.json', import.meta.url), 'utf8')));
for (const page of appConfig.pages) {
  for (const extension of ['ts', 'wxml', 'less', 'json']) {
    const pageFile = new URL(`../apps/miniprogram/miniprogram/${page}.${extension}`, import.meta.url);
    await import('node:fs/promises').then(({ access }) => access(pageFile));
  }
}
console.log(`Validated ${appConfig.pages.length} mini-program pages`);

for (const [command, args] of commands) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const players of [3, 4, 6, 8]) {
  console.log(`\n> simulate ${players} players`);
  const result = spawnSync('node', [
    '--experimental-strip-types',
    'packages/test-bots/src/cli.ts',
    '--players',
    String(players),
    '--seed',
    '20260901',
  ], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
