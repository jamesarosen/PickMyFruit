CREATE TABLE notification_subscriptions (
	id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	throttle_period text NOT NULL,
	produce_types text,
	center_h3 text NOT NULL,
	resolution integer NOT NULL,
	ring_size integer NOT NULL DEFAULT 0,
	location_name text NOT NULL DEFAULT '',
	last_notified_at integer,
	created_at integer DEFAULT (unixepoch()) NOT NULL,
	updated_at integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX notification_subscriptions_user_id_idx ON notification_subscriptions(user_id);
--> statement-breakpoint
-- Composite index serves both getSubscriptionsDue (throttle_period + last_notified_at)
-- and queries filtered on throttle_period alone (leftmost prefix).
CREATE INDEX notification_subscriptions_throttle_notified_idx ON notification_subscriptions(throttle_period, last_notified_at);
