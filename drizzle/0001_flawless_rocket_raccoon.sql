CREATE TABLE `ledger_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`ledger_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
