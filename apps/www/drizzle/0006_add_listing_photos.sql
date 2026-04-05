CREATE TABLE listing_photos (
	id text PRIMARY KEY NOT NULL,
	listing_id integer NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
	ext text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	created_at integer DEFAULT (unixepoch()) NOT NULL,
	deleted_at integer
);
--> statement-breakpoint
CREATE INDEX listing_photos_listing_id_idx ON listing_photos (listing_id);
--> statement-breakpoint
CREATE INDEX listing_photos_listing_order_idx ON listing_photos (listing_id, "order");
