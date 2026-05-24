import type { Client } from "@libsql/client";

/** Maximum UTF-8 byte size for persisted workflow JSON payloads. */
export const maxPayloadBytes = 1_000_000;

/** Schema SQL for kokoto's SQLite persistence tables. */
export const kokotoSchemaSql = [
	`CREATE TABLE IF NOT EXISTS _dc_workflow (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'error', 'cancelled')),
		worker_pool TEXT NOT NULL DEFAULT 'node-default',
		queue TEXT,
		input TEXT NOT NULL CHECK (json_valid(input) AND length(CAST(input AS BLOB)) <= 1000000),
		output TEXT CHECK (output IS NULL OR (json_valid(output) AND length(CAST(output AS BLOB)) <= 1000000)),
		error TEXT CHECK (error IS NULL OR (json_valid(error) AND length(CAST(error AS BLOB)) <= 1000000)),
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
	)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_status_scheduled_created_idx
		ON _dc_workflow (status, scheduled_for, created_at)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_queue_status_scheduled_idx
		ON _dc_workflow (queue, status, scheduled_for)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_name_status_idx
		ON _dc_workflow (name, status)`,
	`CREATE INDEX IF NOT EXISTS _dc_workflow_executor_status_idx
		ON _dc_workflow (executor_id, status)`,
	`CREATE TABLE IF NOT EXISTS _dc_step (
		workflow_id TEXT NOT NULL REFERENCES _dc_workflow(id) ON DELETE CASCADE,
		step_id TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
		output TEXT CHECK (output IS NULL OR (json_valid(output) AND length(CAST(output AS BLOB)) <= 1000000)),
		error TEXT CHECK (error IS NULL OR (json_valid(error) AND length(CAST(error AS BLOB)) <= 1000000)),
		attempts INTEGER NOT NULL DEFAULT 0,
		started_at INTEGER,
		ended_at INTEGER,
		PRIMARY KEY (workflow_id, step_id)
	)`,
	`CREATE TABLE IF NOT EXISTS _dc_executor (
		id TEXT PRIMARY KEY,
		started_at INTEGER NOT NULL,
		heartbeat_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS _dc_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
	`INSERT INTO _dc_meta (key, value)
		VALUES ('protocol_version', '1')
		ON CONFLICT(key) DO NOTHING`,
	`INSERT INTO _dc_meta (key, value)
		VALUES ('last_full_integrity_check_ms', '0')
		ON CONFLICT(key) DO NOTHING`,
] as const;

/** Installs kokoto tables into a SQLite database. */
export async function installKokotoSchema(client: Client): Promise<void> {
	for (const statement of kokotoSchemaSql) {
		await client.execute(statement);
	}
}
