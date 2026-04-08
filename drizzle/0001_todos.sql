CREATE TABLE `todos` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `content` text NOT NULL,
  `status` text NOT NULL,
  `priority` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `todos_created_at_idx` ON `todos` (`created_at`);
--> statement-breakpoint
CREATE INDEX `todos_status_updated_idx` ON `todos` (`status`, `updated_at`);
