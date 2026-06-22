CREATE TABLE `mcp_oauth_sessions` (
	`server_id` text PRIMARY KEY NOT NULL,
	`client_info_json` text,
	`tokens_json` text,
	`expires_at` integer,
	`code_verifier` text,
	`state` text,
	`server_url` text,
	`status` text DEFAULT 'unauthorized' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mcp_oauth_sessions_state_idx` ON `mcp_oauth_sessions` (`state`);