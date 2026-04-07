CREATE TABLE `conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `last_message_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `conversations_last_message_idx` ON `conversations` (`last_message_at`);
--> statement-breakpoint
CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `role` text NOT NULL,
  `metadata_json` text,
  `parts_json` text NOT NULL,
  `position` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`, `position`);
--> statement-breakpoint
CREATE TABLE `notes` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `tags_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notes_created_at_idx` ON `notes` (`created_at`);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_id` text NOT NULL,
  `message_id` text NOT NULL,
  `tool_call_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `state` text NOT NULL,
  `input_json` text,
  `output_json` text,
  `error_text` text,
  `position` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tool_calls_conversation_idx` ON `tool_calls` (`conversation_id`, `position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_calls_conversation_call_idx` ON `tool_calls` (`conversation_id`, `tool_call_id`);
