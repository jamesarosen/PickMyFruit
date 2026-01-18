--> statement-breakpoint
UPDATE plants SET status = 'unavailable' WHERE status IN ('claimed', 'harvested');
--> statement-breakpoint
-- Add soft delete column with index for efficient filtering
ALTER TABLE plants ADD COLUMN deleted_at integer;
--> statement-breakpoint
CREATE INDEX plants_deleted_at_idx ON plants(deleted_at);
--> statement-breakpoint
-- Create inquiries table
CREATE TABLE inquiries (
	id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	created_at integer DEFAULT (unixepoch()) NOT NULL,
	listing_id integer NOT NULL REFERENCES plants(id),
	gleaner_id text NOT NULL REFERENCES user(id),
	note text,
	email_sent_at integer
);
--> statement-breakpoint
CREATE INDEX inquiry_listing_id_idx ON inquiries(listing_id);
--> statement-breakpoint
CREATE INDEX inquiry_gleaner_id_idx ON inquiries(gleaner_id);
