-- Durable workflow runtime (@pickmyfruit/kokoto) — `_dc_*` tables.
-- Canonical DDL lives in `packages/kokoto/src/schema.server.ts` (KOKOTO_DDL).
-- Keep this file and that constant in sync: when one changes, change the other.

CREATE TABLE IF NOT EXISTS _dc_workflow (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('pending','running','success','error','cancelled')),
	queue TEXT,
	input TEXT NOT NULL CHECK (
		json_valid(input)
		AND length(cast(input AS BLOB)) <= 1000000
	),
	output TEXT CHECK (
		output IS NULL
		OR (json_valid(output) AND length(cast(output AS BLOB)) <= 1000000)
	),
	error TEXT CHECK (
		error IS NULL
		OR (json_valid(error) AND length(cast(error AS BLOB)) <= 1000000)
	),
	attempts INTEGER NOT NULL DEFAULT 0,
	max_attempts INTEGER NOT NULL DEFAULT 3,
	executor_id TEXT,
	scheduled_for INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	started_at INTEGER,
	ended_at INTEGER,
	idempotency_key TEXT UNIQUE,
	cancel_requested_at INTEGER,
	protocol_version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS _dc_workflow_status_sched_created_idx
	ON _dc_workflow (status, scheduled_for, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS _dc_workflow_queue_status_sched_idx
	ON _dc_workflow (queue, status, scheduled_for);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS _dc_workflow_name_status_idx
	ON _dc_workflow (name, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS _dc_workflow_executor_status_idx
	ON _dc_workflow (executor_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS _dc_step (
	workflow_id TEXT NOT NULL REFERENCES _dc_workflow(id) ON DELETE CASCADE,
	step_id TEXT NOT NULL,
	name TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('success','error')),
	output TEXT CHECK (
		output IS NULL
		OR (json_valid(output) AND length(cast(output AS BLOB)) <= 1000000)
	),
	error TEXT CHECK (
		error IS NULL
		OR (json_valid(error) AND length(cast(error AS BLOB)) <= 1000000)
	),
	attempts INTEGER NOT NULL DEFAULT 1,
	duration_ms INTEGER,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workflow_id, step_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS _dc_step_workflow_idx
	ON _dc_step (workflow_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS _dc_executor (
	id TEXT PRIMARY KEY,
	started_at INTEGER NOT NULL,
	heartbeat_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS _dc_meta (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO _dc_meta (key, value) VALUES ('protocol_version', '1');
