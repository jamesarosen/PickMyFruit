-- International address support (docs/0011-international-address-entry.md).
-- Rebuild listings to drop the US-centric column defaults ('Napa'/'CA'),
-- make the region line (`state`) nullable, and add an ISO 3166-1 alpha-2
-- `country` column. SQLite cannot ALTER a column's NOT NULL or DEFAULT,
-- hence the rebuild.
--
-- Both migration runners (drizzle-kit migrate and the boot-time
-- drizzle-orm/libsql migrator) execute through @libsql/client `migrate()`,
-- which turns foreign_keys off for the duration, so child tables
-- (inquiries, address_reveals, listing_photos) keep their references to
-- `listings` across the drop-and-rename.
CREATE TABLE `listings_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`variety` text,
	`status` text DEFAULT 'available' NOT NULL,
	`quantity` text,
	`harvest_window` text,
	`address` text NOT NULL,
	`city` text NOT NULL,
	`state` text,
	`zip` text,
	`country` text DEFAULT 'US' NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`h3_index` text NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`accepts_drop_offs` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`access_instructions` text,
	`address_release_policy` text DEFAULT 'on_owner_approval' NOT NULL
		CHECK (`address_release_policy` IN ('on_owner_approval','on_verified_request')),
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
-- Every pre-international listing is in the US.
INSERT INTO `listings_new`
	(`id`, `name`, `type`, `variety`, `status`, `quantity`, `harvest_window`,
	 `address`, `city`, `state`, `zip`, `country`, `lat`, `lng`, `h3_index`,
	 `user_id`, `accepts_drop_offs`, `notes`, `access_instructions`,
	 `address_release_policy`, `deleted_at`, `created_at`, `updated_at`)
SELECT
	`id`, `name`, `type`, `variety`, `status`, `quantity`, `harvest_window`,
	`address`, `city`, `state`, `zip`, 'US', `lat`, `lng`, `h3_index`,
	`user_id`, `accepts_drop_offs`, `notes`, `access_instructions`,
	`address_release_policy`, `deleted_at`, `created_at`, `updated_at`
FROM `listings`;
--> statement-breakpoint
DROP TABLE `listings`;
--> statement-breakpoint
ALTER TABLE `listings_new` RENAME TO `listings`;
--> statement-breakpoint
CREATE INDEX `listings_user_id_idx` ON `listings` (`user_id`);
--> statement-breakpoint
CREATE INDEX `listings_deleted_at_idx` ON `listings` (`deleted_at`);
