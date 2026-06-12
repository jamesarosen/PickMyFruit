-- The public feed filters on status + deleted_at and orders by created_at
-- (getAvailableListings / getNearbyListings). The existing single-column
-- listings_deleted_at_idx cannot serve that plan; this composite index can.
CREATE INDEX listings_status_deleted_created_idx ON listings (status, deleted_at, created_at);
