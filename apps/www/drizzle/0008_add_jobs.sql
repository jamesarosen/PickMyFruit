CREATE TABLE jobs (
	id text PRIMARY KEY NOT NULL,
	queue text NOT NULL,
	data text NOT NULL,
	created_at integer DEFAULT (unixepoch() * 1000) NOT NULL,
	available_at integer NOT NULL,
	claimed_at integer,
	claimed_by text,
	lease_seconds integer,
	attempts integer DEFAULT 0 NOT NULL,
	last_error text,
	completed_at integer,
	failed_at integer
);
--> statement-breakpoint
CREATE INDEX jobs_eligibility_idx ON jobs (queue, completed_at, failed_at, available_at, id);
