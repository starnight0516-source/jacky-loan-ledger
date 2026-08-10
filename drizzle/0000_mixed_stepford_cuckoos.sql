CREATE TABLE `shared_ledgers` (
	`id` text PRIMARY KEY NOT NULL,
	`write_token_hash` text NOT NULL,
	`state_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
