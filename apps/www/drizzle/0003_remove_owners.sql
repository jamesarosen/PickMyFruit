-- Backfill user_id for any listings that have owner_id but no user_id
-- Maps owners.email → user.email to find the corresponding user.id
UPDATE `listings`
SET `user_id` = (
  SELECT `u`.`id`
  FROM `user` `u`
  JOIN `owners` `o` ON `o`.`email` = `u`.`email`
  WHERE `o`.`id` = `listings`.`owner_id`
)
WHERE `user_id` IS NULL AND `owner_id` IS NOT NULL;
--> statement-breakpoint
-- Delete any listings that still have no user_id (no matching user found)
DELETE FROM `listings` WHERE `user_id` IS NULL;
--> statement-breakpoint
-- Recreate listings table without owner_id, with user_id NOT NULL and ON DELETE CASCADE
CREATE TABLE `listings_new` (
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
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`notes` text,
	`access_instructions` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `listings_new`
  (`id`, `name`, `type`, `variety`, `status`, `quantity`, `harvest_window`,
   `address`, `city`, `state`, `zip`, `lat`, `lng`, `h3_index`,
   `user_id`, `notes`, `access_instructions`, `created_at`, `updated_at`)
SELECT
  `id`, `name`, `type`, `variety`, `status`, `quantity`, `harvest_window`,
  `address`, `city`, `state`, `zip`, `lat`, `lng`, `h3_index`,
  `user_id`, `notes`, `access_instructions`, `created_at`, `updated_at`
FROM `listings`;
--> statement-breakpoint
DROP TABLE `listings`;
--> statement-breakpoint
ALTER TABLE `listings_new` RENAME TO `listings`;
--> statement-breakpoint
-- Add index on user_id for query performance (matches auth table pattern)
CREATE INDEX `listings_user_id_idx` ON `listings` (`user_id`);
--> statement-breakpoint
-- Drop owners table and its index
DROP INDEX IF EXISTS `owners_email_unique`;
--> statement-breakpoint
DROP TABLE `owners`;
