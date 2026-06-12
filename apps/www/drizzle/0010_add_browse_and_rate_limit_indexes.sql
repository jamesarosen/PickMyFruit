-- Supports the public browse queries (getAvailableListings, getNearbyListings):
-- status = ? AND deleted_at IS NULL ORDER BY created_at DESC
CREATE INDEX listings_status_deleted_created_idx ON listings (status, deleted_at, created_at);
--> statement-breakpoint
-- Supports the 24h inquiry rate-limit check (hasRecentInquiry):
-- gleaner_id = ? AND listing_id = ? AND created_at > ?
CREATE INDEX inquiry_gleaner_listing_created_idx ON inquiries (gleaner_id, listing_id, created_at);
