CREATE TABLE resend_sync_state (
	key text PRIMARY KEY NOT NULL,
	value text NOT NULL,
	updated_at integer NOT NULL
);
--> statement-breakpoint
INSERT INTO resend_sync_state (key, value, updated_at) VALUES ('cursor', '{"updatedAt":0,"userId":""}', unixepoch() * 1000);
--> statement-breakpoint
CREATE INDEX user_updated_at_id_idx ON user (updated_at, id);
