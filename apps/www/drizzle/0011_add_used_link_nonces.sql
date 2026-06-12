CREATE TABLE `used_link_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`listing_id` integer NOT NULL,
	`used_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `used_link_nonces_used_at_idx` ON `used_link_nonces` (`used_at`);
