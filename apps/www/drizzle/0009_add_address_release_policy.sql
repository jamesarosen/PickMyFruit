-- Add per-listing address release policy. Default preserves the existing
-- owner-approval behavior for every existing listing.
ALTER TABLE listings ADD COLUMN address_release_policy TEXT NOT NULL
	DEFAULT 'on_owner_approval'
	CHECK (address_release_policy IN ('on_owner_approval','on_verified_request'));
--> statement-breakpoint
-- Append-only record of address reveals. This is NOT an access-control table —
-- authorization for `on_verified_request` is a property of the viewer
-- (user.email_verified). This log exists for attribution, unique-member
-- analytics, and as the seed for future gleaner follow-ups.
CREATE TABLE address_reveals (
	id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	user_id text NOT NULL REFERENCES user(id) ON DELETE CASCADE,
	listing_id integer NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
	created_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX address_reveals_listing_idx ON address_reveals (listing_id, created_at);
--> statement-breakpoint
CREATE INDEX address_reveals_user_idx ON address_reveals (user_id, created_at);
