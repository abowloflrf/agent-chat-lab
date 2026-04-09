CREATE TABLE `system_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `tavily_api_key` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `model_providers` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `base_url` text NOT NULL,
  `api_key` text NOT NULL,
  `is_enabled` integer NOT NULL,
  `is_default` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `model_providers_enabled_idx` ON `model_providers` (`is_enabled`, `updated_at`);
--> statement-breakpoint
CREATE TABLE `provider_models` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `is_enabled` integer NOT NULL,
  `is_default` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`provider_id`) REFERENCES `model_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `provider_models_provider_idx` ON `provider_models` (`provider_id`, `updated_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_models_provider_model_idx` ON `provider_models` (`provider_id`, `model_id`);
