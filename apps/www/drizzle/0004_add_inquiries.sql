UPDATE listings SET status = 'unavailable' WHERE status IN ('claimed', 'harvested');
--> statement-breakpoint
-- Add soft delete column with index for efficient filtering
ALTER TABLE listings ADD COLUMN deleted_at integer;
--> statement-breakpoint
CREATE INDEX listings_deleted_at_idx ON listings(deleted_at);
--> statement-breakpoint
-- Create inquiries table
CREATE TABLE inquiries (
	id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	created_at integer DEFAULT (unixepoch()) NOT NULL,
	listing_id integer NOT NULL REFERENCES listings(id),
	gleaner_id text NOT NULL REFERENCES user(id),
	note text,
	email_sent_at integer
);
--> statement-breakpoint
CREATE INDEX inquiry_listing_id_idx ON inquiries(listing_id);
--> statement-breakpoint
CREATE INDEX inquiry_gleaner_id_idx ON inquiries(gleaner_id);
