import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

export const players = mysqlTable(
  'players',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    wechatOpenId: varchar('wechat_open_id', { length: 128 }).notNull(),
    nickname: varchar('nickname', { length: 48 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 1024 }).notNull(),
    deleted: boolean('deleted').notNull().default(false),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => [uniqueIndex('players_wechat_open_id_unique').on(table.wechatOpenId)],
);

export const sessions = mysqlTable(
  'sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    playerId: varchar('player_id', { length: 36 }).notNull(),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    expiresAt: timestamp('expires_at', { mode: 'string' }).notNull(),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_player_idx').on(table.playerId),
  ],
);

export const rooms = mysqlTable(
  'rooms',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    code: varchar('code', { length: 6 }).notNull(),
    ownerPlayerId: varchar('owner_player_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['WAITING', 'IN_GAME', 'FINISHED', 'DISBANDED'])
      .notNull()
      .default('WAITING'),
    createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'string' }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => [uniqueIndex('rooms_code_unique').on(table.code)],
);

export const roomPlayers = mysqlTable(
  'room_players',
  {
    roomId: varchar('room_id', { length: 36 }).notNull(),
    playerId: varchar('player_id', { length: 36 }).notNull(),
    seat: int('seat').notNull(),
    ready: boolean('ready').notNull().default(false),
    joinedAt: timestamp('joined_at', { mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('room_players_room_player_unique').on(table.roomId, table.playerId),
    uniqueIndex('room_players_room_seat_unique').on(table.roomId, table.seat),
    index('room_players_player_idx').on(table.playerId),
  ],
);

export const games = mysqlTable(
  'games',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    roomId: varchar('room_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', ['IN_PROGRESS', 'ROUND_SETTLEMENT', 'FINISHED'])
      .notNull()
      .default('IN_PROGRESS'),
    stateVersion: bigint('state_version', { mode: 'number', unsigned: true }).notNull(),
    eventSequence: bigint('event_sequence', { mode: 'number', unsigned: true }).notNull(),
    rulesVersion: varchar('rules_version', { length: 32 }).notNull(),
    startedAt: timestamp('started_at', { mode: 'string' }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { mode: 'string' }),
  },
  (table) => [
    uniqueIndex('games_room_unique').on(table.roomId),
    index('games_status_idx').on(table.status),
  ],
);

export const gamePlayers = mysqlTable(
  'game_players',
  {
    gameId: varchar('game_id', { length: 36 }).notNull(),
    playerId: varchar('player_id', { length: 36 }).notNull(),
    seat: int('seat').notNull(),
    nicknameSnapshot: varchar('nickname_snapshot', { length: 48 }).notNull(),
    avatarUrlSnapshot: varchar('avatar_url_snapshot', { length: 1024 }).notNull(),
    finalCash: int('final_cash'),
    finalPlace: int('final_place'),
    winner: boolean('winner'),
  },
  (table) => [
    uniqueIndex('game_players_game_player_unique').on(table.gameId, table.playerId),
    uniqueIndex('game_players_game_seat_unique').on(table.gameId, table.seat),
  ],
);

export const gameEvents = mysqlTable(
  'game_events',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    gameId: varchar('game_id', { length: 36 }).notNull(),
    roomId: varchar('room_id', { length: 36 }).notNull(),
    sequence: bigint('sequence', { mode: 'number', unsigned: true }).notNull(),
    requestId: varchar('request_id', { length: 64 }),
    actorPlayerId: varchar('actor_player_id', { length: 36 }),
    type: varchar('type', { length: 64 }).notNull(),
    rulesVersion: varchar('rules_version', { length: 32 }).notNull(),
    payload: json('payload').notNull(),
    occurredAt: timestamp('occurred_at', { mode: 'string', fsp: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('game_events_game_sequence_unique').on(table.gameId, table.sequence),
    index('game_events_game_idx').on(table.gameId),
  ],
);

export const gameSnapshots = mysqlTable(
  'game_snapshots',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    gameId: varchar('game_id', { length: 36 }).notNull(),
    stateVersion: bigint('state_version', { mode: 'number', unsigned: true }).notNull(),
    eventSequence: bigint('event_sequence', { mode: 'number', unsigned: true }).notNull(),
    state: json('state').notNull(),
    createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('game_snapshots_game_version_unique').on(table.gameId, table.stateVersion),
    index('game_snapshots_game_sequence_idx').on(table.gameId, table.eventSequence),
  ],
);

export const commandResults = mysqlTable(
  'command_results',
  {
    requestId: varchar('request_id', { length: 64 }).primaryKey(),
    gameId: varchar('game_id', { length: 36 }).notNull(),
    result: json('result').notNull(),
    createdAt: timestamp('created_at', { mode: 'string', fsp: 3 }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('command_results_request_unique').on(table.requestId),
    index('command_results_game_idx').on(table.gameId),
  ],
);

export const gameResults = mysqlTable(
  'game_results',
  {
    gameId: varchar('game_id', { length: 36 }).primaryKey(),
    result: json('result').notNull(),
    finishedAt: timestamp('finished_at', { mode: 'string', fsp: 3 }).notNull(),
  },
);
