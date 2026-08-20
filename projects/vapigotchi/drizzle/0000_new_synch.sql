CREATE TABLE `pet_calls` (
	`call_id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`status` text NOT NULL,
	`speaker` text,
	`started_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pet_calls_pet_id_status_idx` ON `pet_calls` (`pet_id`,`status`);--> statement-breakpoint
CREATE TABLE `pet_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pet_id` text NOT NULL,
	`type` text NOT NULL,
	`food` text,
	`health_gain` integer,
	`health_after` integer,
	`call_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pet_events_pet_id_id_idx` ON `pet_events` (`pet_id`,`id`);--> statement-breakpoint
CREATE TABLE `pets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'VapiGotchi' NOT NULL,
	`is_personalized` integer DEFAULT false NOT NULL,
	`health` integer DEFAULT 35 NOT NULL,
	`meals_eaten` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`health_updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
