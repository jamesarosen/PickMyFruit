-- Community Produce Stands. A stand is the `produce-stand` produce type plus a
-- take-and-give flag. The address-release policy (0009) is orthogonal — a stand
-- may use either policy.

-- Two-way (take-and-give) flag. Take-only listings keep the default (0).
ALTER TABLE listings ADD COLUMN accepts_drop_offs INTEGER NOT NULL DEFAULT 0;
