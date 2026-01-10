-- Create owners table
CREATE TABLE `owners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_email_unique` ON `owners` (`email`);
--> statement-breakpoint
-- Recreate plants table with owner_id foreign key
DROP TABLE `plants`;
--> statement-breakpoint
CREATE TABLE `plants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`variety` text,
	`status` text DEFAULT 'available' NOT NULL,
	`quantity` text,
	`harvest_window` text,
	`address` text NOT NULL,
	`city` text DEFAULT 'Napa' NOT NULL,
	`state` text DEFAULT 'CA' NOT NULL,
	`zip` text,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`h3_index` text NOT NULL,
	`owner_id` integer NOT NULL REFERENCES `owners`(`id`),
	`notes` text,
	`access_instructions` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
