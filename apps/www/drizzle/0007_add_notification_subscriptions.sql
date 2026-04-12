CREATE TABLE `notification_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`label` text,
	`center_h3` text NOT NULL,
	`resolution` integer NOT NULL,
	`ring_size` integer NOT NULL,
	`place_name` text NOT NULL,
	`produce_types` text,
	`throttle_period` text NOT NULL CHECK (`throttle_period` IN ('immediately', 'weekly')),
	`last_notified_at` integer,
	`enabled` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL DEFAULT (unixepoch()),
	`updated_at` integer NOT NULL DEFAULT (unixepoch()),
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `notification_subscriptions_user_id_idx` ON `notification_subscriptions`(`user_id`);
--> statement-breakpoint
CREATE INDEX `notification_subscriptions_throttle_notified_idx` ON `notification_subscriptions`(`throttle_period`, `last_notified_at`)
WHERE `deleted_at` IS NULL AND `enabled` = 1;
--> statement-breakpoint
CREATE TRIGGER `enforce_subscription_limit`
BEFORE INSERT ON `notification_subscriptions`
BEGIN
  SELECT RAISE(ABORT, 'subscription_limit_exceeded')
  WHERE (SELECT COUNT(*) FROM `notification_subscriptions`
         WHERE `user_id` = NEW.`user_id` AND `deleted_at` IS NULL) >= 10;
END;
