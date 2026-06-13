CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`tool_call_id` text,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`sha256` text NOT NULL,
	`source` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artifacts_conversation_idx` ON `artifacts` (`conversation_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_conversation_path_idx` ON `artifacts` (`conversation_id`,`path`);