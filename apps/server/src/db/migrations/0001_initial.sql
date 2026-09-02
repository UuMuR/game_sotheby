CREATE TABLE IF NOT EXISTS `players` (
  `id` varchar(36) NOT NULL,
  `wechat_open_id` varchar(128) NOT NULL,
  `nickname` varchar(48) NOT NULL,
  `avatar_url` varchar(1024) NOT NULL,
  `deleted` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `players_wechat_open_id_unique` (`wechat_open_id`)
);

CREATE TABLE IF NOT EXISTS `sessions` (
  `id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `token_hash` varchar(128) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sessions_token_hash_unique` (`token_hash`),
  KEY `sessions_player_idx` (`player_id`)
);

CREATE TABLE IF NOT EXISTS `rooms` (
  `id` varchar(36) NOT NULL,
  `code` varchar(6) NOT NULL,
  `owner_player_id` varchar(36) NOT NULL,
  `status` enum('WAITING','IN_GAME','FINISHED','DISBANDED') NOT NULL DEFAULT 'WAITING',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rooms_code_unique` (`code`)
);

CREATE TABLE IF NOT EXISTS `room_players` (
  `room_id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `seat` int NOT NULL,
  `ready` boolean NOT NULL DEFAULT false,
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `room_players_room_player_unique` (`room_id`, `player_id`),
  UNIQUE KEY `room_players_room_seat_unique` (`room_id`, `seat`),
  KEY `room_players_player_idx` (`player_id`)
);

CREATE TABLE IF NOT EXISTS `games` (
  `id` varchar(36) NOT NULL,
  `room_id` varchar(36) NOT NULL,
  `status` enum('IN_PROGRESS','ROUND_SETTLEMENT','FINISHED') NOT NULL DEFAULT 'IN_PROGRESS',
  `state_version` bigint unsigned NOT NULL,
  `event_sequence` bigint unsigned NOT NULL,
  `rules_version` varchar(32) NOT NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` timestamp NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `games_room_unique` (`room_id`),
  KEY `games_status_idx` (`status`)
);

CREATE TABLE IF NOT EXISTS `game_players` (
  `game_id` varchar(36) NOT NULL,
  `player_id` varchar(36) NOT NULL,
  `seat` int NOT NULL,
  `nickname_snapshot` varchar(48) NOT NULL,
  `avatar_url_snapshot` varchar(1024) NOT NULL,
  `final_cash` int NULL,
  `final_place` int NULL,
  `winner` boolean NULL,
  UNIQUE KEY `game_players_game_player_unique` (`game_id`, `player_id`),
  UNIQUE KEY `game_players_game_seat_unique` (`game_id`, `seat`)
);

CREATE TABLE IF NOT EXISTS `game_events` (
  `id` varchar(64) NOT NULL,
  `game_id` varchar(36) NOT NULL,
  `room_id` varchar(36) NOT NULL,
  `sequence` bigint unsigned NOT NULL,
  `request_id` varchar(64) NULL,
  `actor_player_id` varchar(36) NULL,
  `type` varchar(64) NOT NULL,
  `rules_version` varchar(32) NOT NULL,
  `payload` json NOT NULL,
  `occurred_at` timestamp(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `game_events_game_sequence_unique` (`game_id`, `sequence`),
  KEY `game_events_game_idx` (`game_id`)
);

CREATE TABLE IF NOT EXISTS `game_snapshots` (
  `id` varchar(64) NOT NULL,
  `game_id` varchar(36) NOT NULL,
  `state_version` bigint unsigned NOT NULL,
  `event_sequence` bigint unsigned NOT NULL,
  `state` json NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `game_snapshots_game_version_unique` (`game_id`, `state_version`),
  KEY `game_snapshots_game_sequence_idx` (`game_id`, `event_sequence`)
);

CREATE TABLE IF NOT EXISTS `command_results` (
  `request_id` varchar(64) NOT NULL,
  `game_id` varchar(36) NOT NULL,
  `result` json NOT NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`request_id`),
  UNIQUE KEY `command_results_request_unique` (`request_id`),
  KEY `command_results_game_idx` (`game_id`)
);

CREATE TABLE IF NOT EXISTS `game_results` (
  `game_id` varchar(36) NOT NULL,
  `result` json NOT NULL,
  `finished_at` timestamp(3) NOT NULL,
  PRIMARY KEY (`game_id`)
);
