# 《决战苏富比》好友测试版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可供 3～8 名微信好友开房、完成四阶段完整对局、支持断线重连与结果留存的微信小程序测试版。

**Architecture:** 使用 pnpm monorepo，将纯 TypeScript 规则引擎、共享协议、Fastify 权威服务端和原生微信小程序分离。MySQL 是持久化事件与快照的恢复来源，Redis 保存活跃状态、连接映射、房间锁和超时索引；小程序只发送命令并渲染服务端按玩家身份裁剪后的视图。

**Tech Stack:** TypeScript、pnpm workspace、Vitest projects、Fastify、`@fastify/websocket`/`ws`、Zod、Drizzle ORM + `mysql2`、`ioredis`、MySQL、Redis、Docker Compose、微信原生小程序 TypeScript 编译插件、`miniprogram-ci`。

**Spec:** `docs/superpowers/specs/2026-09-01-sotheby-game-design.md`

## Global Constraints

- 游戏规则以 `docs/game-rules.md` 为唯一产品规则基线。
- 支持 3～8 名玩家；每局四个阶段；金额整数单位统一为 1 万元。
- 服务端是成交、现金、主持权、倒计时和结算的唯一权威。
- 客户端不得收到其他玩家现金、手牌或未揭晓暗标报价。
- 所有失窃藏品的竞拍方式必须为 `SEALED_BID`；联合拍卖藏品不得失窃。
- 首版使用 `docs/data/placeholder-collections.json` 的 84 张测试牌库和本地占位图片。
- CDN 仅允许通过集中式资源解析器替换，并保留 `TODO(CDN_ASSET)` 注释。
- 每个客户端命令必须携带 `requestId` 与 `stateVersion`；重复请求不得重复执行。
- 同一房间的命令必须串行；超时任务重复触发时只能有一次生效。
- 先完成自动化测试和测试环境好友试玩，再配置生产发布。

## Planned File Structure

```text
sotheby/
├── package.json                       # workspace scripts and shared dev tools
├── pnpm-workspace.yaml                # apps/* and packages/*
├── tsconfig.base.json                 # strict shared TypeScript options
├── vitest.config.ts                   # Vitest projects configuration
├── docker-compose.dev.yml             # local MySQL and Redis
├── .env.example                       # non-secret environment contract
├── apps/
│   ├── server/
│   │   ├── src/app.ts                 # Fastify composition root
│   │   ├── src/server.ts              # process startup/shutdown
│   │   ├── src/config.ts              # validated environment variables
│   │   ├── src/auth/                   # wx.login exchange and game session
│   │   ├── src/rooms/                  # lobby HTTP use cases
│   │   ├── src/games/                  # command pipeline, projections, timers
│   │   ├── src/db/                     # Drizzle schema, migrations, repositories
│   │   └── test/                       # API/WebSocket/recovery integration tests
│   └── miniprogram/
│       ├── project.config.json         # native TS compiler plugin
│       ├── miniprogram/app.ts          # bootstrap/session/reconnect
│       ├── miniprogram/pages/          # 8 confirmed pages
│       ├── miniprogram/components/     # cards, player strip, bid controls
│       ├── miniprogram/services/       # HTTP, socket, session and commands
│       ├── miniprogram/store/          # visible game state only
│       ├── miniprogram/assets/         # local placeholder images
│       └── test/                       # view-model and service tests
├── packages/
│   ├── contracts/src/                 # commands, events, views, schemas
│   ├── game-engine/src/               # pure deterministic state machine
│   └── test-bots/src/                  # seeded 3/4/6/8-player simulations
├── scripts/
│   ├── validate-catalog.ts             # hard constraints for 84 cards
│   ├── generate-placeholders.ts        # local series placeholder images
│   └── verify-mvp.ts                   # release-gate orchestration
└── docs/                               # approved rules, design and operations docs
```

---

## Phase 1 — Workspace and Deterministic Game Engine

### Task 1: Bootstrap the TypeScript Monorepo and Local Dependencies

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `docker-compose.dev.yml`
- Create: `packages/contracts/package.json`
- Create: `packages/game-engine/package.json`
- Create: `packages/test-bots/package.json`
- Create: `apps/server/package.json`
- Create: `apps/miniprogram/package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces workspace commands: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm dev:deps`.
- Produces TypeScript path aliases: `@sotheby/contracts`, `@sotheby/game-engine`.

- [ ] **Step 1: Write the workspace smoke test**

Create `packages/contracts/src/workspace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('workspace', () => {
  it('runs TypeScript tests from a workspace project', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run the smoke test and verify the missing workspace fails**

Run: `corepack pnpm test -- packages/contracts/src/workspace.test.ts`

Expected: FAIL because the root workspace and Vitest configuration do not exist.

- [ ] **Step 3: Create the root workspace configuration**

Use this root `package.json` shape:

```json
{
  "name": "sotheby-game",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "dev:deps": "docker compose -f docker-compose.dev.yml up -d",
    "dev:deps:down": "docker compose -f docker-compose.dev.yml down",
    "typecheck": "pnpm -r typecheck",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "verify": "pnpm lint && pnpm typecheck && pnpm test"
  },
  "devDependencies": {
    "@eslint/js": "latest",
    "@types/node": "latest",
    "eslint": "latest",
    "typescript": "latest",
    "typescript-eslint": "latest",
    "vitest": "latest"
  }
}
```

Configure `vitest.config.ts` with `test.projects` for `packages/*` and `apps/*`; configure `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `resolveJsonModule`, and `moduleResolution: "Bundler"`.

- [ ] **Step 4: Add local MySQL and Redis**

Create `docker-compose.dev.yml` with MySQL database `sotheby`, application user `sotheby`, and Redis persistence enabled. Put only development credentials in `.env.example`; keep `.env` ignored.

- [ ] **Step 5: Install and verify the workspace**

Run:

```bash
corepack enable
pnpm install
pnpm test -- packages/contracts/src/workspace.test.ts
pnpm typecheck
```

Expected: smoke test PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add sotheby/package.json sotheby/pnpm-workspace.yaml sotheby/tsconfig.base.json sotheby/vitest.config.ts sotheby/docker-compose.dev.yml sotheby/.env.example sotheby/.gitignore sotheby/packages sotheby/apps
 git commit -m "build(sotheby): bootstrap TypeScript workspace"
```

### Task 2: Define Shared Contracts and Validate the 84-Card Catalog

**Files:**
- Create: `packages/contracts/src/cards.ts`
- Create: `packages/contracts/src/commands.ts`
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/views.ts`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/game-engine/src/catalog.ts`
- Create: `packages/game-engine/src/catalog.test.ts`
- Create: `scripts/validate-catalog.ts`
- Modify: `packages/contracts/src/workspace.test.ts` (remove after replacement tests pass)

**Interfaces:**
- Produces `CollectionSeries`, `AuctionType`, `CardDefinition`, `GameCommand`, `GameEvent`, `PlayerGameView`.
- Produces `loadPlaceholderCatalog(): readonly CardDefinition[]`.
- Consumes `docs/data/placeholder-collections.json` as the checked-in test catalog.

- [ ] **Step 1: Write failing catalog invariants**

```ts
it('contains the fixed 84-card distribution', () => {
  const cards = loadPlaceholderCatalog();
  expect(cards).toHaveLength(84);
  expect(countBy(cards, 'series')).toEqual({
    BLACK: 15, BLUE: 16, GREEN: 17, YELLOW: 18, RED: 18,
  });
});

it('restricts stolen cards to sealed bids', () => {
  expect(loadPlaceholderCatalog().filter(c => c.stolen))
    .toSatisfyAll(card => card.auctionType === 'SEALED_BID');
});
```

Use standard array assertions rather than adding a custom matcher if `toSatisfyAll` is unavailable.

- [ ] **Step 2: Run the catalog test and verify failure**

Run: `pnpm vitest run packages/game-engine/src/catalog.test.ts`

Expected: FAIL because contracts and `loadPlaceholderCatalog` do not exist.

- [ ] **Step 3: Implement exact shared enums and schemas**

```ts
export const COLLECTION_SERIES = ['BLACK', 'BLUE', 'GREEN', 'YELLOW', 'RED'] as const;
export type CollectionSeries = typeof COLLECTION_SERIES[number];

export const AUCTION_TYPES = ['OPEN', 'SEQUENTIAL', 'FIXED_PRICE', 'JOINT', 'SEALED_BID'] as const;
export type AuctionType = typeof AUCTION_TYPES[number];

export interface CardDefinition {
  id: string;
  name: string;
  series: CollectionSeries;
  rarity: 1 | 2 | 3 | 4 | 5;
  auctionType: AuctionType;
  stolen: boolean;
  imageKey: string;
}
```

Define command envelopes as `{ requestId, roomId, playerId, stateVersion, type, payload }`; define event envelopes as `{ eventId, sequence, gameId, roomId, actorPlayerId, occurredAt, rulesVersion, type, payload }`.

- [ ] **Step 4: Implement catalog parsing and validation**

`loadPlaceholderCatalog()` must parse the JSON, reject duplicate IDs/names, enforce all series totals, enforce rarity 1–5, enforce legal auction types, and reject any stolen non-sealed-bid card or stolen joint card.

- [ ] **Step 5: Verify the catalog and contracts**

Run:

```bash
pnpm vitest run packages/game-engine/src/catalog.test.ts
pnpm tsx scripts/validate-catalog.ts
pnpm typecheck
```

Expected: all commands exit 0 and the script prints `84 cards valid`.

- [ ] **Step 6: Commit**

```bash
git add sotheby/packages/contracts sotheby/packages/game-engine sotheby/scripts/validate-catalog.ts
 git commit -m "feat(engine): define contracts and validate card catalog"
```

### Task 3: Implement Game Initialization, Seating, Visibility, and Turn Rotation

**Files:**
- Create: `packages/game-engine/src/model.ts`
- Create: `packages/game-engine/src/random.ts`
- Create: `packages/game-engine/src/initialize.ts`
- Create: `packages/game-engine/src/projection.ts`
- Create: `packages/game-engine/src/turns.ts`
- Create: `packages/game-engine/src/initialize.test.ts`
- Create: `packages/game-engine/src/projection.test.ts`

**Interfaces:**
- Produces `initializeGame(input: InitializeGameInput): GameState`.
- Produces `projectForPlayer(state: GameState, playerId: string): PlayerGameView`.
- Produces `nextSeatPlayerId(state, playerId): string`.
- Uses injected `RandomSource` so tests can supply a fixed seed.

- [ ] **Step 1: Write failing tests for 3-, 4-, 6-, and 8-player setup**

Assert initial cash `150`, hand counts `11/10/8/6`, unique dealt cards, a single random host, round `1`, state version `1`, and no public purchased cards.

- [ ] **Step 2: Write a failing privacy projection test**

```ts
const aliceView = projectForPlayer(state, 'alice');
expect(aliceView.self.cash).toBe(150);
expect(aliceView.self.hand).toHaveLength(11);
expect(aliceView.players.find(p => p.id === 'bob')).not.toHaveProperty('cash');
expect(JSON.stringify(aliceView)).not.toContain(state.players.bob.hand[0]!.cardId);
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm vitest run packages/game-engine/src/initialize.test.ts packages/game-engine/src/projection.test.ts`

Expected: FAIL because initialization and projection modules do not exist.

- [ ] **Step 4: Implement deterministic initialization**

Represent money as signed integer `Money` units of 10,000 CNY. Represent seats as a stable ordered array. Shuffle the catalog only through `RandomSource.shuffle`; deal without replacement; keep remaining deck private.

- [ ] **Step 5: Implement recipient-specific projection**

Return full `self` data only for the requesting player. For other players return ID, game nickname/avatar snapshot, seat, online flag, public purchased cards, public card count, and action markers.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run packages/game-engine/src/initialize.test.ts packages/game-engine/src/projection.test.ts && pnpm typecheck`

```bash
git add sotheby/packages/game-engine/src
 git commit -m "feat(engine): initialize games and protect private views"
```

### Task 4: Implement Standard Auction State Machines

**Files:**
- Create: `packages/game-engine/src/commands.ts`
- Create: `packages/game-engine/src/reducer.ts`
- Create: `packages/game-engine/src/auctions/open.ts`
- Create: `packages/game-engine/src/auctions/fixed-price.ts`
- Create: `packages/game-engine/src/auctions/sequential.ts`
- Create: `packages/game-engine/src/auctions/payment.ts`
- Create: `packages/game-engine/src/auctions/standard.test.ts`

**Interfaces:**
- Produces `handleCommand(state, command, now): CommandResult`.
- `CommandResult` is `{ state: GameState; events: GameEvent[]; scheduledDeadlines: Deadline[] }`.
- Produces `settleStandardPurchase(state, sellerId, buyerId, price): CashTransfer[]`.

- [ ] **Step 1: Write failing public-auction tests**

Cover minimum 1, +1 minimum increment, cash ceiling, 30-second reset, expired bid rejection, no-bid host acquisition at 0, and normal buyer/host payment routing.

- [ ] **Step 2: Write failing fixed-price tests**

Cover 60-second host pricing timeout to 0, clockwise 30-second buyer decisions, first acceptance wins, all-decline host purchase, and debt/zero-cash host restricted to price 0.

- [ ] **Step 3: Write failing sequential-auction tests**

Cover one action per player, clockwise order ending with host, 30-second timeout as pass, strictly higher bid, and all-pass host acquisition at 0.

- [ ] **Step 4: Run the tests and verify failure**

Run: `pnpm vitest run packages/game-engine/src/auctions/standard.test.ts`

Expected: FAIL with missing reducer and auction handlers.

- [ ] **Step 5: Implement command validation before mutation**

Return typed rejections such as `NOT_YOUR_TURN`, `INSUFFICIENT_CASH`, `STALE_STATE`, `AUCTION_EXPIRED`, `INVALID_INCREMENT`, and `PLAYER_NOT_ELIGIBLE`; rejected commands leave state and event sequence unchanged.

- [ ] **Step 6: Implement the three standard auction reducers**

Use immutable state transitions. Each accepted command increments `stateVersion`; every emitted event receives the next consecutive sequence. Every deadline stores `{ id, roomId, gameId, expectedStateVersion, expiresAt, action }`.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run packages/game-engine/src/auctions/standard.test.ts && pnpm typecheck`

```bash
git add sotheby/packages/game-engine/src
 git commit -m "feat(engine): implement standard auction modes"
```

### Task 5: Implement Normal/Stolen Sealed Bids and Joint Auctions

**Files:**
- Create: `packages/game-engine/src/auctions/sealed-bid.ts`
- Create: `packages/game-engine/src/auctions/joint.ts`
- Create: `packages/game-engine/src/auctions/sealed-bid.test.ts`
- Create: `packages/game-engine/src/auctions/joint.test.ts`
- Modify: `packages/game-engine/src/reducer.ts`
- Modify: `packages/game-engine/src/projection.ts`

**Interfaces:**
- Produces `resolveNormalSealedBid(state): AuctionResolution`.
- Produces `resolveStolenSealedBid(state): AuctionResolution`.
- Produces `splitJointPrice(price): { oldHostShare: Money; newHostShare: Money }`.
- Produces joint-flow commands `CHOOSE_SELF_JOINT_CARD`, `INVITE_JOINT_PLAYER`, `RESPOND_JOINT_INVITE`.

- [ ] **Step 1: Write failing normal sealed-bid privacy and tie tests**

Assert eligible players submit at least 1, submissions remain hidden until resolution, timeout means no bid, highest wins, and ties resolve clockwise from the host's left with host last.

- [ ] **Step 2: Write failing stolen sealed-bid tests**

Assert non-host players must participate, host may abstain, zero/debt players submit 0, timeout auto-submits 0, lowest wins without paying, all losing bidders pay the bank, and low ties use the same seat priority.

- [ ] **Step 3: Write failing joint-auction tests**

Cover same-series/non-stolen/non-joint validation, self-joint mode, invite timeouts, zero/debt player allowed as new host but not buyer, no partner means old host receives initial card free, joint price split `ceil/floor`, and next host is left of new host.

- [ ] **Step 4: Run tests and verify failure**

Run: `pnpm vitest run packages/game-engine/src/auctions/sealed-bid.test.ts packages/game-engine/src/auctions/joint.test.ts`

- [ ] **Step 5: Implement private bid storage and projections**

Store bids in authoritative state keyed by player ID. Before reveal, player projection exposes only whether each player submitted and the requester's own amount; after reveal, expose all amounts.

- [ ] **Step 6: Implement joint settlement exactly**

```ts
export function splitJointPrice(price: Money) {
  return {
    oldHostShare: Math.ceil(price / 2) as Money,
    newHostShare: Math.floor(price / 2) as Money,
  };
}
```

Apply the three approved buyer cases without creating money beyond the waived new-host share.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run packages/game-engine/src/auctions/sealed-bid.test.ts packages/game-engine/src/auctions/joint.test.ts && pnpm typecheck`

```bash
git add sotheby/packages/game-engine/src
 git commit -m "feat(engine): implement sealed and joint auctions"
```

### Task 6: Implement Round Ending, Settlement, Debt, Refill, and Final Ranking

**Files:**
- Create: `packages/game-engine/src/rounds/end-condition.ts`
- Create: `packages/game-engine/src/rounds/ranking.ts`
- Create: `packages/game-engine/src/rounds/settlement.ts`
- Create: `packages/game-engine/src/rounds/refill.ts`
- Create: `packages/game-engine/src/game-result.ts`
- Create: `packages/game-engine/src/rounds/settlement.test.ts`
- Create: `packages/game-engine/src/game-result.test.ts`
- Modify: `packages/game-engine/src/reducer.ts`

**Interfaces:**
- Produces `checkRoundEnd(state, playedCards): RoundEndDecision`.
- Produces `rankSeries(counts): RankedSeries[]`.
- Produces `settleRound(state): RoundSettlement`.
- Produces `applyIncome(balance, amount): { balance; debtRepaid; availableIncome }`.
- Produces `rankPlayers(players): FinalStanding[]`.

- [ ] **Step 1: Write failing sixth-card tests**

Cover normal sixth card, joint initial card as sixth, joint second card as sixth causing both cards to be void, and all hands empty as an alternate ending.

- [ ] **Step 2: Write failing series ranking tests**

Assert count descending, tie priority `BLACK > BLUE > GREEN > YELLOW > RED`, new prices `30/20/10/0/0`, and cross-round accumulation.

- [ ] **Step 3: Write failing settlement/debt tests**

Assert normal cards pay `rarity × cumulativeSeriesPrice`; valuable stolen cards charge the same amount; zero-value stolen cards pay/charge 0; negative balances are allowed; later income first offsets debt.

- [ ] **Step 4: Write failing refill and final-result tests**

Cover refill counts for rounds 2 and 3, no round-4 refill, next-round host left of ending host/old host, net-balance descending rank, tied positions, and multiple winners.

- [ ] **Step 5: Run tests and verify failure**

Run: `pnpm vitest run packages/game-engine/src/rounds packages/game-engine/src/game-result.test.ts`

- [ ] **Step 6: Implement settlement as an auditable ledger**

Every balance change must emit `{ playerId, reason, counterparty, before, delta, after, cardId? }`. Settlement returns public series rankings plus player-specific private ledger details.

- [ ] **Step 7: Verify the complete engine**

Run: `pnpm vitest run packages/game-engine && pnpm typecheck`

Expected: every engine test passes with no database or network process running.

- [ ] **Step 8: Commit**

```bash
git add sotheby/packages/game-engine/src
 git commit -m "feat(engine): settle rounds and rank final results"
```

### Task 7: Add Seeded Full-Game Simulation Bots

**Files:**
- Create: `packages/test-bots/src/bot.ts`
- Create: `packages/test-bots/src/strategy.ts`
- Create: `packages/test-bots/src/simulate.ts`
- Create: `packages/test-bots/src/simulate.test.ts`
- Create: `packages/test-bots/src/cli.ts`

**Interfaces:**
- Produces `simulateGame({ playerCount, seed }): SimulationResult`.
- Produces CLI: `pnpm simulate --players 8 --seed 20260901`.

- [ ] **Step 1: Write failing simulations for 3, 4, 6, and 8 players**

Each test must assert `status === 'FINISHED'`, `round === 4`, consecutive event sequences, no card in two zones, legal balances, and at least one winner.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run packages/test-bots/src/simulate.test.ts`

- [ ] **Step 3: Implement deterministic legal-action bots**

The strategy must query `getLegalActions(state, playerId)`, choose only legal actions using the seeded random source, and advance time to deadlines when no immediate action exists.

- [ ] **Step 4: Add invariants after every command**

Check unique card location, monotonically increasing state/event versions, one active auction at most, valid host/player IDs, and no private bid in another player's projection.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm vitest run packages/test-bots/src/simulate.test.ts
pnpm simulate --players 3 --seed 20260901
pnpm simulate --players 4 --seed 20260901
pnpm simulate --players 6 --seed 20260901
pnpm simulate --players 8 --seed 20260901
```

```bash
git add sotheby/packages/test-bots
 git commit -m "test(engine): simulate complete multiplayer games"
```

---

## Phase 2 — Authoritative Online Service

### Task 8: Create MySQL Schema, Migrations, and Repositories

**Files:**
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/client.ts`
- Create: `apps/server/src/db/migrations/0001_initial.sql`
- Create: `apps/server/src/db/repositories/player-repository.ts`
- Create: `apps/server/src/db/repositories/room-repository.ts`
- Create: `apps/server/src/db/repositories/game-repository.ts`
- Create: `apps/server/src/db/repositories/event-repository.ts`
- Create: `apps/server/src/db/repositories/idempotency-repository.ts`
- Create: `apps/server/test/db/repositories.test.ts`

**Interfaces:**
- Produces transactional `appendEventsAndSnapshot(input): Promise<PersistedGameState>`.
- Produces `loadGameForRecovery(gameId): Promise<{ snapshot; eventsAfterSnapshot }>`.
- Produces `findCommandResult(requestId): Promise<StoredCommandResult | null>`.

- [ ] **Step 1: Write failing repository integration tests**

Test unique room codes, one active game per player, strictly unique `(gameId, sequence)`, idempotent request IDs, snapshot versioning, and ordered recovery events.

- [ ] **Step 2: Start local dependencies and verify test failure**

Run:

```bash
pnpm dev:deps
pnpm vitest run apps/server/test/db/repositories.test.ts
```

Expected: FAIL because schema and repositories do not exist.

- [ ] **Step 3: Implement the schema**

Create tables for `players`, `sessions`, `rooms`, `room_players`, `games`, `game_players`, `game_events`, `game_snapshots`, `command_results`, and `game_results`. Store event/snapshot payloads as JSON and money as signed integers.

- [ ] **Step 4: Implement one MySQL transaction per accepted command**

Inside the transaction: lock the game row, verify expected state version, insert events, insert/update command result, and write a snapshot at required checkpoints. Redis cache updates happen only after commit.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run apps/server/test/db/repositories.test.ts && pnpm typecheck`

```bash
git add sotheby/apps/server/src/db sotheby/apps/server/test/db
 git commit -m "feat(server): persist events snapshots and command results"
```

### Task 9: Implement WeChat Login and Lobby HTTP APIs

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/auth/wechat-client.ts`
- Create: `apps/server/src/auth/session-service.ts`
- Create: `apps/server/src/auth/routes.ts`
- Create: `apps/server/src/rooms/room-code.ts`
- Create: `apps/server/src/rooms/room-service.ts`
- Create: `apps/server/src/rooms/routes.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/test/auth-and-room.test.ts`

**Interfaces:**
- HTTP `POST /v1/auth/wechat-login`.
- HTTP `POST /v1/profile`, `PATCH /v1/profile`.
- HTTP `POST /v1/rooms`, `POST /v1/rooms/:code/join`, `POST /v1/rooms/:id/ready`, `POST /v1/rooms/:id/start`, `DELETE /v1/rooms/:id/players/:playerId`.
- Produces signed opaque session tokens stored hashed in MySQL.

- [ ] **Step 1: Write failing API tests with a fake WeChat client**

Cover account reuse by OpenID, 1–12 character nickname validation, six-digit room code, 3–8 capacity, ready/unready, owner kick, owner clockwise transfer, start conditions, and post-start join rejection.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/server/test/auth-and-room.test.ts`

- [ ] **Step 3: Implement validated configuration and dependency injection**

`buildApp({ db, redis, wechatClient, clock, randomSource })` must accept fakes in tests. Never call WeChat or environment globals from domain services.

- [ ] **Step 4: Implement login/session/profile routes**

Exchange `wx.login` code only on the server. Store OpenID encrypted or access-restricted; return a game session token. Add account deletion request endpoint that anonymizes profile linkage while preserving anonymous game result integrity.

- [ ] **Step 5: Implement room service and start transaction**

Starting a room calls the engine initializer, stores player nickname/avatar snapshots, writes initial events/snapshot, and returns personalized views.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run apps/server/test/auth-and-room.test.ts && pnpm typecheck`

```bash
git add sotheby/apps/server/src/auth sotheby/apps/server/src/rooms sotheby/apps/server/src/app.ts sotheby/apps/server/test/auth-and-room.test.ts
 git commit -m "feat(server): add login and friend room APIs"
```

### Task 10: Implement WebSocket Sessions, Command Serialization, and View Broadcasts

**Files:**
- Create: `apps/server/src/games/socket-route.ts`
- Create: `apps/server/src/games/connection-registry.ts`
- Create: `apps/server/src/games/room-lock.ts`
- Create: `apps/server/src/games/command-service.ts`
- Create: `apps/server/src/games/broadcaster.ts`
- Create: `apps/server/test/game-socket.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Client message: `{ type: 'COMMAND'; requestId; roomId; stateVersion; command }`.
- Server messages: `STATE`, `COMMAND_ACCEPTED`, `COMMAND_REJECTED`, `CONNECTION_STATUS`.
- Produces `executeSerializedCommand(envelope): Promise<CommandResponse>`.

- [ ] **Step 1: Write failing WebSocket tests**

Connect multiple fake players; assert authenticated join, personalized initial state, bid broadcast, private-state isolation, duplicate `requestId` returning the original result, stale version rejection, and two simultaneous bids producing one serialized order.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/server/test/game-socket.test.ts`

- [ ] **Step 3: Implement Redis-backed room lock**

Use `SET lock:room:{roomId} token NX PX 5000`; release with a Lua compare-and-delete script. After lock acquisition, reload authoritative version before handling the command.

- [ ] **Step 4: Implement command persistence pipeline**

Order: authenticate → acquire room lock → return stored duplicate result if present → load state → validate version → run engine → persist MySQL transaction → update Redis snapshot → release lock → broadcast recipient-specific views.

- [ ] **Step 5: Implement per-recipient broadcasting**

Generate a fresh `projectForPlayer` view for every connected player. Never broadcast authoritative `GameState` or raw unrevealed event payloads.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run apps/server/test/game-socket.test.ts && pnpm typecheck`

```bash
git add sotheby/apps/server/src/games sotheby/apps/server/test/game-socket.test.ts sotheby/apps/server/src/app.ts
 git commit -m "feat(server): process authoritative websocket commands"
```

### Task 11: Implement Deadlines, Disconnect Status, and Crash Recovery

**Files:**
- Create: `apps/server/src/games/deadline-store.ts`
- Create: `apps/server/src/games/deadline-worker.ts`
- Create: `apps/server/src/games/recovery-service.ts`
- Create: `apps/server/src/server.ts`
- Create: `apps/server/test/deadline-and-recovery.test.ts`

**Interfaces:**
- Redis sorted set key `game:deadlines` with deadline IDs as members.
- Produces `scheduleDeadlines(deadlines)` and `claimDueDeadline(now)`.
- Produces `recoverActiveGames(): Promise<void>`.

- [ ] **Step 1: Write failing timer and recovery tests**

Cover public bid expiry, sequential pass, fixed-price default 0, normal sealed pass, stolen sealed auto-0, joint invite decline, duplicate deadline firing, process restart after MySQL commit/before Redis cache update, and same-account reconnect.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/server/test/deadline-and-recovery.test.ts`

- [ ] **Step 3: Implement idempotent deadline commands**

Deadline command IDs must be deterministic from `{ gameId, deadlineId, expectedStateVersion }`. Repeated workers submit the same `requestId`, so command idempotency prevents duplicate settlement.

- [ ] **Step 4: Implement startup recovery**

On server start, query active games, load latest MySQL snapshot plus subsequent events, rebuild Redis state, re-register future deadlines, and immediately process overdue deadlines in sequence.

- [ ] **Step 5: Implement connection presence**

Track connection IDs in Redis with heartbeat expiry. Disconnect marks a player offline but does not remove the seat; reconnect replaces stale connection mappings and sends the full current personalized view.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run apps/server/test/deadline-and-recovery.test.ts && pnpm typecheck`

```bash
git add sotheby/apps/server/src/games sotheby/apps/server/src/server.ts sotheby/apps/server/test/deadline-and-recovery.test.ts
 git commit -m "feat(server): recover games and execute reliable deadlines"
```

---

## Phase 3 — Native WeChat Mini Program

### Task 12: Bootstrap the Mini Program, Session Flow, Home, Profile, and Lobby

**Files:**
- Create: `apps/miniprogram/project.config.json`
- Create: `apps/miniprogram/miniprogram/app.ts`
- Create: `apps/miniprogram/miniprogram/app.json`
- Create: `apps/miniprogram/miniprogram/app.less`
- Create: `apps/miniprogram/miniprogram/services/http.ts`
- Create: `apps/miniprogram/miniprogram/services/session.ts`
- Create: `apps/miniprogram/miniprogram/pages/login/*`
- Create: `apps/miniprogram/miniprogram/pages/home/*`
- Create: `apps/miniprogram/miniprogram/pages/profile/*`
- Create: `apps/miniprogram/miniprogram/pages/lobby/*`
- Create: `apps/miniprogram/test/session-and-lobby.test.ts`

**Interfaces:**
- Produces `loginWithWechat(): Promise<Session>`.
- Produces `createRoom()`, `joinRoom(code)`, `setReady(ready)`, `startRoom()`.
- `project.config.json` enables `useCompilerPlugins: ["typescript", "less"]`.

- [ ] **Step 1: Write failing session and lobby view-model tests**

Cover new-user profile flow, existing session restore, six-digit room validation, shared-room launch parameter, owner controls, non-owner ready controls, 3–8 start conditions, and ongoing-game resume routing.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/miniprogram/test/session-and-lobby.test.ts`

- [ ] **Step 3: Implement platform adapters**

Wrap `wx.login`, storage, request, navigation, share, and network status behind small interfaces so tests use fakes. HTTP errors map to stable UI codes such as `ROOM_NOT_FOUND`, `ROOM_FULL`, and `GAME_ALREADY_STARTED`.

- [ ] **Step 4: Implement the four pages**

Login/profile enforce 1–12 characters and default avatar fallback. Home exposes create/join/resume/rules/profile. Lobby renders seat order, owner/ready/online states, share action, and owner start/kick controls.

- [ ] **Step 5: Verify in tests and developer-tool configuration**

Run: `pnpm vitest run apps/miniprogram/test/session-and-lobby.test.ts && pnpm typecheck`

Check `project.config.json` has native TypeScript compilation and the correct `miniprogramRoot`.

- [ ] **Step 6: Commit**

```bash
git add sotheby/apps/miniprogram
 git commit -m "feat(miniprogram): add login home profile and lobby"
```

### Task 13: Implement the A-Layout Game Table and All Auction Overlays

**Files:**
- Create: `apps/miniprogram/miniprogram/store/game-store.ts`
- Create: `apps/miniprogram/miniprogram/services/game-socket.ts`
- Create: `apps/miniprogram/miniprogram/services/game-commands.ts`
- Create: `apps/miniprogram/miniprogram/services/asset-resolver.ts`
- Create: `apps/miniprogram/miniprogram/pages/game/*`
- Create: `apps/miniprogram/miniprogram/components/player-strip/*`
- Create: `apps/miniprogram/miniprogram/components/collection-card/*`
- Create: `apps/miniprogram/miniprogram/components/hand-drawer/*`
- Create: `apps/miniprogram/miniprogram/components/bid-panel/*`
- Create: `apps/miniprogram/miniprogram/components/joint-panel/*`
- Create: `apps/miniprogram/miniprogram/components/market-panel/*`
- Create: `apps/miniprogram/miniprogram/assets/placeholders/*`
- Create: `apps/miniprogram/test/game-store.test.ts`
- Create: `apps/miniprogram/test/game-page.test.ts`
- Create: `scripts/generate-placeholders.ts`

**Interfaces:**
- Produces `GameSocket.connect(session, roomId)` and `GameSocket.sendCommand(command)`.
- Produces `resolveCardImage(cardId, series): string`.
- Store accepts only `PlayerGameView`; it never stores authoritative state.

- [ ] **Step 1: Write failing store/reconnect tests**

Assert full `STATE` replaces local state, out-of-order versions are ignored, rejected command restores server state, reconnect requests a fresh snapshot, and deadline display derives from server `expiresAt`.

- [ ] **Step 2: Write failing game-page interaction tests**

Cover card selection, open bid increment/custom bid, sequential pass/bid, fixed-price set/accept/decline, normal/stolen sealed bid, joint self/invite/response, disabled controls for zero/debt players, and offline indicators.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm vitest run apps/miniprogram/test/game-store.test.ts apps/miniprogram/test/game-page.test.ts`

- [ ] **Step 4: Generate local placeholder assets and centralized resolver**

Generate one thumbnail and one large placeholder per series plus stolen-border treatment. Implement:

```ts
// TODO(CDN_ASSET): 正式藏品图片上传 CDN 后，在此替换资源映射或 CDN 基础地址。
const CDN_BASE_URL = '';

export function resolveCardImage(cardId: string, series: CollectionSeries): string {
  return CDN_BASE_URL
    ? `${CDN_BASE_URL}/collections/v1/${cardId.toLowerCase()}.webp`
    : `/assets/placeholders/${series.toLowerCase()}.webp`;
}
```

Add image error fallback to the series placeholder.

- [ ] **Step 5: Implement the confirmed A layout**

Top status → compact player strip → dominant one/two-card lot → fixed bid/action panel → collapsible hand drawer. Use text/icon markers in addition to color for host, acting player, high bidder, stolen card, and offline status.

- [ ] **Step 6: Implement the socket lifecycle**

Connect after entering/resuming a game, authenticate, replace state on `STATE`, back off reconnect attempts, refresh on foreground return, and never infer auction outcomes locally.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run apps/miniprogram/test/game-store.test.ts apps/miniprogram/test/game-page.test.ts && pnpm typecheck`

Use WeChat Developer Tools to preview the game page at narrow and large phone sizes.

```bash
git add sotheby/apps/miniprogram sotheby/scripts/generate-placeholders.ts
 git commit -m "feat(miniprogram): build the live auction game table"
```

### Task 14: Implement Settlement, Results, Rules, and History Pages

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/round-result/*`
- Create: `apps/miniprogram/miniprogram/pages/final-result/*`
- Create: `apps/miniprogram/miniprogram/pages/rules/*`
- Create: `apps/miniprogram/miniprogram/pages/history/*`
- Create: `apps/server/src/results/routes.ts`
- Create: `apps/server/test/results.test.ts`
- Create: `apps/miniprogram/test/results-pages.test.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- HTTP `GET /v1/games/:gameId/result` and `GET /v1/me/game-history`.
- Round result view contains public series ranking and current player's private ledger.

- [ ] **Step 1: Write failing API and page tests**

Cover history ownership, anonymized deleted profiles, round ranking order, income/fine/debt lines, resulting balance, tied final places, multiple winner labels, and return-home navigation.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run apps/server/test/results.test.ts apps/miniprogram/test/results-pages.test.ts`

- [ ] **Step 3: Implement result APIs without private leakage**

Return only the requesting player's private settlement entries plus public rankings. Historical results contain final balances and placements but not former private hands or unrevealed bids.

- [ ] **Step 4: Implement the four pages**

Round result uses ordered reveal sections. Final result highlights all place-1 players. Rules content is structured from `docs/game-rules.md`; history shows date, player count, final balance, placement, and a summary detail page.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run apps/server/test/results.test.ts apps/miniprogram/test/results-pages.test.ts && pnpm typecheck`

```bash
git add sotheby/apps/server/src/results sotheby/apps/server/test/results.test.ts sotheby/apps/miniprogram
 git commit -m "feat(mvp): add settlement results rules and history"
```

---

## Phase 4 — End-to-End Verification and Friend-Test Deployment

### Task 15: Add End-to-End Multiplayer Tests and Release Automation

**Files:**
- Create: `apps/server/test/e2e/four-round-game.test.ts`
- Create: `apps/server/test/e2e/reconnect-and-idempotency.test.ts`
- Create: `scripts/verify-mvp.ts`
- Create: `scripts/miniprogram-ci.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docs/operations/local-development.md`
- Create: `docs/operations/test-environment.md`
- Create: `docs/operations/release-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Root command `pnpm verify:mvp` runs lint, typecheck, unit tests, integrations, simulations, and production builds.
- Root command `pnpm mini:preview` invokes `miniprogram-ci` with environment-provided AppID/private key.

- [ ] **Step 1: Write a failing four-round online test**

Use HTTP to create three users/room, start the game, connect three WebSockets, drive commands with legal-action bots, and assert the final result API returns a finished game with complete event sequence and rankings.

- [ ] **Step 2: Write a failing reconnect/idempotency test**

Disconnect a bidder, let the server apply timeout, reconnect with the same account, resend a previously accepted request ID, and assert state/balance/event counts do not duplicate.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm vitest run apps/server/test/e2e`

- [ ] **Step 4: Add production builds and verification orchestration**

`pnpm verify:mvp` must run:

```text
catalog validation
→ lint
→ typecheck
→ game-engine tests
→ server repository/API/WebSocket/recovery tests
→ mini-program logic tests
→ 3/4/6/8 player simulations
→ server production build
→ mini-program TypeScript check
```

- [ ] **Step 5: Add container and environment documentation**

The server image runs as a non-root user, exposes a health endpoint, reads secrets only from environment variables, and handles SIGTERM by stopping new commands, finishing the current room transaction, and closing connections.

- [ ] **Step 6: Add secure mini-program preview/upload script**

Read `WECHAT_APP_ID` and `WECHAT_PRIVATE_KEY_PATH` from the environment. Never commit upload keys. Document WeChat IP allowlist and test-environment domain configuration.

- [ ] **Step 7: Run the full release gate**

Run:

```bash
pnpm dev:deps
pnpm verify:mvp
```

Expected: every step exits 0; 3/4/6/8 simulations finish; no privacy/idempotency/recovery failures.

- [ ] **Step 8: Perform manual friend-test acceptance**

In the test environment, complete at least one 3-player and one 8-player real-device game. Record device models, network interruptions tested, game IDs, and observed issues in `docs/operations/release-checklist.md`.

- [ ] **Step 9: Commit**

```bash
git add sotheby/apps/server/test/e2e sotheby/scripts sotheby/Dockerfile sotheby/.dockerignore sotheby/docs/operations sotheby/package.json
 git commit -m "test(mvp): add end-to-end release gate"
```

## Execution Checkpoints

1. **Checkpoint A — Engine playable without UI:** Tasks 1–7 complete; all rules and seeded full-game simulations pass.
2. **Checkpoint B — Online service playable by scripted clients:** Tasks 8–11 complete; HTTP/WebSocket/recovery tests pass.
3. **Checkpoint C — WeChat client feature-complete:** Tasks 12–14 complete; all eight pages and auction overlays work against the test server.
4. **Checkpoint D — Friend-test release candidate:** Task 15 complete; `pnpm verify:mvp` passes and real-device friend testing is recorded.

## Self-Review Results

- **Spec coverage:** Rules, architecture, rooms, login, privacy, A-layout UI, 84-card placeholder catalog, tests, environments, reconnect, history, CDN replacement point, and MVP exclusions each map to at least one task.
- **Placeholder scan:** The only intentional `TODO` is the exact approved `TODO(CDN_ASSET)` code comment at the centralized asset replacement point.
- **Type consistency:** Commands use `requestId`, `roomId`, `playerId`, `stateVersion`, `type`, `payload`; results use `GameState`, `GameEvent[]`, and `Deadline[]` throughout engine, server, and client tasks.
