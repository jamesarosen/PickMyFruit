-- Recreate inquiries table with ON DELETE CASCADE on both foreign keys.
-- SQLite does not support ALTER TABLE to modify foreign key constraints.

-- Clean up orphaned inquiries before copying into the new FK-enforced table.
DELETE FROM inquiries WHERE listing_id NOT IN (SELECT id FROM listings);
--> statement-breakpoint
DELETE FROM inquiries WHERE gleaner_id NOT IN (SELECT id FROM user);
--> statement-breakpoint
CREATE TABLE inquiries_new (
	id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	created_at integer DEFAULT (unixepoch()) NOT NULL,
	listing_id integer NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
	gleaner_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	note text,
	email_sent_at integer
);
--> statement-breakpoint
INSERT INTO inquiries_new (id, created_at, listing_id, gleaner_id, note, email_sent_at)
	SELECT id, created_at, listing_id, gleaner_id, note, email_sent_at FROM inquiries;
--> statement-breakpoint
DROP TABLE inquiries;
--> statement-breakpoint
ALTER TABLE inquiries_new RENAME TO inquiries;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inquiry_listing_id_idx ON inquiries(listing_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inquiry_gleaner_id_idx ON inquiries(gleaner_id);
