PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `agents`;--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`agent_type` text NOT NULL,
	`hydra_client_id` text NOT NULL,
	`spend_cap_cents` integer,
	`expires_at` integer,
	`allowed_merchants_json` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
PRAGMA foreign_keys=ON;
