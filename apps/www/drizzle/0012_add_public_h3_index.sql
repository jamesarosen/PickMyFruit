-- Add the public (resolution-8) H3 cell used for privacy-preserving viewport
-- and area queries. Filtering on this coarsened cell — never raw lat/lng — is
-- what keeps map panning/zooming from revealing a listing's location any finer
-- than the ~0.74 km² public detail it already discloses.
--
-- Populated by application code (`createListing`) for every new row. H3 cannot
-- be computed in SQLite, so pre-existing rows are left NULL here and backfilled
-- out of band by `pnpm db:backfill-public-h3` (or `toPublicListing` derives the
-- value on the fly for the non-viewport read paths). Nullable so the ALTER
-- needs no computed default.
ALTER TABLE listings ADD COLUMN public_h3_index text;
--> statement-breakpoint
CREATE INDEX listings_public_h3_index_idx ON listings (public_h3_index);
