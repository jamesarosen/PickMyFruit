/**
 * Schema reference for the `_dc_*` tables that back the kokoto runtime.
 *
 * The host application owns its own migration journal (`apps/www/drizzle/`) —
 * this module exposes the canonical SQL so the app's migration file and the
 * runtime's expectations cannot drift apart. The {@link createSchemaSQL}
 * helper is also used by the test harness to create in-memory databases.
 */

export const PROTOCOL_VERSION = 1

/** Maximum size (in bytes) of any JSON column on a workflow or step row. */
export const PAYLOAD_BYTE_CAP = 1_000_000

/**
 * DDL statements, in dependency order. Each statement is idempotent — `CREATE
 * TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` — so the same SQL can
 * power a fresh in-memory test DB or a no-op on a database that already has
 * these tables (the app's migration journal will run them exactly once).
 */
export const KOKOTO_DDL: ReadonlyArray<string> = [
	`CREATE TABLE IF NOT EXISTS _dc_workflow (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending','running','success','error','cancelled')),
		queue TEXT,
		input TEXT NOT NULL CHECK (
			json_valid(input)
			AND length(cast(input AS BLOB)) <= ${PAYLOAD_BYTE_CAP}
		),
		output TEXT CHECK (
			output IS NULL
			OR (json_valid(output) AND length(cast(output AS BLOB)) <= ${PAYLOAD_BYTE_CAP})
		),
		error TEXT CHECK (
			error IS NULL
			OR (json_valid(error) AND length(cast(error AS BLOB)) <= ${PAYLOAD_BYTE_CAP})
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
		protocol_version INTEGER NOT NULL DEFAULT ${PROTOCOL_VERSION}
	)`,
	// Per-row `_dc_workflow.protocol_version` is vestigial in v1;
	// `_dc_meta.protocol_version` is the canonical source. The per-row column
	// stays so a future cross-version migration can gate per-row behavior
	// without a destructive ALTER.
	`CREATE INDEX IF NOT EXISTS _dc_workflow_status_sched_created_idx
		ON _dc_workflow (status, scheduled_for, created_at)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_queue_status_sched_idx
		ON _dc_workflow (queue, status, scheduled_for)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_name_status_idx
		ON _dc_workflow (name, status)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_executor_status_idx
		ON _dc_workflow (executor_id, status)`,
	`CREATE TABLE IF NOT EXISTS _dc_step (
		workflow_id TEXT NOT NULL REFERENCES _dc_workflow(id) ON DELETE CASCADE,
		step_id TEXT NOT NULL,
		name TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('success','error')),
		output TEXT CHECK (
			output IS NULL
			OR (json_valid(output) AND length(cast(output AS BLOB)) <= ${PAYLOAD_BYTE_CAP})
		),
		error TEXT CHECK (
			error IS NULL
			OR (json_valid(error) AND length(cast(error AS BLOB)) <= ${PAYLOAD_BYTE_CAP})
		),
		attempts INTEGER NOT NULL DEFAULT 1,
		duration_ms INTEGER,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (workflow_id, step_id)
	)`,
	`CREATE INDEX IF NOT EXISTS _dc_step_workflow_idx
		ON _dc_step (workflow_id)`,
	// `heartbeat_at` is set once at `runtime.start()` and never updated in v1
	// (we use identity-based reclaim on boot, not lease expiry). Kept so the
	// lease-based recovery path can land without a schema migration.
	`CREATE TABLE IF NOT EXISTS _dc_executor (
		id TEXT PRIMARY KEY,
		started_at INTEGER NOT NULL,
		heartbeat_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS _dc_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`INSERT OR IGNORE INTO _dc_meta (key, value) VALUES ('protocol_version', '${PROTOCOL_VERSION}')`,
]

/** Convenience: joins {@link KOKOTO_DDL} into one semicolon-terminated string. */
export function createSchemaSQL(): string {
	return KOKOTO_DDL.map((stmt) => stmt.trim() + ';').join('\n')
}

/** Names of every kokoto-owned table. Used by retention/cleanup utilities. */
export const KOKOTO_TABLES = [
	'_dc_workflow',
	'_dc_step',
	'_dc_executor',
	'_dc_meta',
] as const
