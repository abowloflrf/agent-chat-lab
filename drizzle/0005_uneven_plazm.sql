CREATE TABLE `usage_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`finish_reason` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`cached_input_tokens` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`tool_call_count` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`day_key` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_records_day_model_idx` ON `usage_records` (`day_key`,`model_id`);--> statement-breakpoint
CREATE INDEX `usage_records_conversation_idx` ON `usage_records` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `usage_records_model_idx` ON `usage_records` (`model_id`);