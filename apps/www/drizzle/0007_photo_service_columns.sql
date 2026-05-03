ALTER TABLE listing_photos ADD COLUMN status text NOT NULL DEFAULT 'complete';
--> statement-breakpoint
ALTER TABLE listing_photos ADD COLUMN key text;
--> statement-breakpoint
ALTER TABLE listing_photos ADD COLUMN width integer;
--> statement-breakpoint
ALTER TABLE listing_photos ADD COLUMN height integer;
--> statement-breakpoint
ALTER TABLE listing_photos ADD COLUMN bytes integer;
--> statement-breakpoint
ALTER TABLE listing_photos ADD COLUMN etag text;
