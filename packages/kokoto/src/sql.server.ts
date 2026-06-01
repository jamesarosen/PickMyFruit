import type { SqlBindable, SqlClient, SqlStatement } from './types.ts'
import { PAYLOAD_BYTE_CAP } from './schema.server.ts'
import { PayloadTooLargeError } from './errors.ts'

/**
 * Encode a value as JSON and assert the result fits the column byte cap. Throws
 * {@link PayloadTooLargeError} when over the limit — surfaced to the caller so
 * they can fail fast instead of producing a SQLite CHECK constraint violation.
 */
export function encodePayload(value: unknown): string {
	const encoded = JSON.stringify(value === undefined ? null : value)
	const bytes = Buffer.byteLength(encoded, 'utf8')
	if (bytes > PAYLOAD_BYTE_CAP) {
		throw new PayloadTooLargeError(bytes)
	}
	return encoded
}

/** Parses a stored JSON column. Returns `undefined` for SQL NULL. */
export function decodePayload<T = unknown>(raw: unknown): T | undefined {
	if (raw == null) return undefined
	if (typeof raw !== 'string') return raw as T
	return JSON.parse(raw) as T
}

/**
 * Serialize an Error for storage in `_dc_workflow.error` / `_dc_step.error`.
 * Captures `name`, `message`, and a truncated stack so replay can reconstruct
 * a useful exception without blowing the byte cap.
 */
export function serializeError(err: unknown): {
	name: string
	message: string
	stack?: string
} {
	if (err instanceof Error) {
		return {
			name: err.name || 'Error',
			message: err.message || String(err),
			stack: err.stack?.slice(0, 4000),
		}
	}
	return { name: 'Error', message: String(err) }
}

export interface WorkflowRow {
	id: string
	name: string
	status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
	queue: string | null
	input: string
	output: string | null
	error: string | null
	attempts: number
	max_attempts: number
	executor_id: string | null
	scheduled_for: number
	created_at: number
	started_at: number | null
	ended_at: number | null
	idempotency_key: string | null
	cancel_requested_at: number | null
	claim_expires_at: number | null
	protocol_version: number
}

export interface StepRow {
	workflow_id: string
	step_id: string
	name: string
	status: 'success' | 'error'
	output: string | null
	error: string | null
	attempts: number
	duration_ms: number | null
	created_at: number
}

export function toWorkflowRow(row: Record<string, unknown>): WorkflowRow {
	return {
		id: String(row.id),
		name: String(row.name),
		status: row.status as WorkflowRow['status'],
		queue: row.queue == null ? null : String(row.queue),
		input: String(row.input),
		output: row.output == null ? null : String(row.output),
		error: row.error == null ? null : String(row.error),
		attempts: Number(row.attempts),
		max_attempts: Number(row.max_attempts),
		executor_id: row.executor_id == null ? null : String(row.executor_id),
		scheduled_for: Number(row.scheduled_for),
		created_at: Number(row.created_at),
		started_at: row.started_at == null ? null : Number(row.started_at),
		ended_at: row.ended_at == null ? null : Number(row.ended_at),
		idempotency_key:
			row.idempotency_key == null ? null : String(row.idempotency_key),
		cancel_requested_at:
			row.cancel_requested_at == null ? null : Number(row.cancel_requested_at),
		claim_expires_at:
			row.claim_expires_at == null ? null : Number(row.claim_expires_at),
		protocol_version: Number(row.protocol_version),
	}
}

export function toStepRow(row: Record<string, unknown>): StepRow {
	return {
		workflow_id: String(row.workflow_id),
		step_id: String(row.step_id),
		name: String(row.name),
		status: row.status as StepRow['status'],
		output: row.output == null ? null : String(row.output),
		error: row.error == null ? null : String(row.error),
		attempts: Number(row.attempts),
		duration_ms: row.duration_ms == null ? null : Number(row.duration_ms),
		created_at: Number(row.created_at),
	}
}

export async function selectWorkflowById(
	client: SqlClient,
	id: string
): Promise<WorkflowRow | undefined> {
	const result = await client.execute({
		sql: 'SELECT * FROM _dc_workflow WHERE id = ? LIMIT 1',
		args: [id],
	})
	const row = result.rows[0]
	return row ? toWorkflowRow(row) : undefined
}

export async function selectWorkflowByIdempotencyKey(
	client: SqlClient,
	key: string
): Promise<WorkflowRow | undefined> {
	const result = await client.execute({
		sql: 'SELECT * FROM _dc_workflow WHERE idempotency_key = ? LIMIT 1',
		args: [key],
	})
	const row = result.rows[0]
	return row ? toWorkflowRow(row) : undefined
}

export async function selectStepsForWorkflow(
	client: SqlClient,
	workflowId: string
): Promise<StepRow[]> {
	const result = await client.execute({
		sql: 'SELECT * FROM _dc_step WHERE workflow_id = ? ORDER BY step_id',
		args: [workflowId],
	})
	return result.rows.map(toStepRow)
}

/**
 * Reset every `running` row whose lease has expired (or was never set) back
 * to `pending`, so the next claim can pick it up. Returns the number of
 * rows reclaimed.
 *
 * Lease-based reclaim replaces the identity-based check that v1 shipped
 * with: a row whose owner is still heartbeating has a fresh
 * `claim_expires_at` and is left alone, so a rolling deploy where two
 * executors are briefly alive does not yank work from the old machine.
 *
 * `claim_expires_at IS NULL` catches rows claimed by older (pre-lease)
 * kokoto code that never wrote the column. Tests rely on this branch too:
 * a row claimed with `leaseMs: 0` writes `now` as the expiry, which is
 * already in the past at read time and reclaims correctly.
 */
export async function reclaimExpired(
	client: SqlClient,
	now: number
): Promise<number> {
	const result = await client.execute({
		sql: `UPDATE _dc_workflow
			SET status = 'pending',
			    executor_id = NULL,
			    started_at = NULL,
			    claim_expires_at = NULL
			WHERE status = 'running'
			  AND (claim_expires_at IS NULL OR claim_expires_at <= ?)`,
		args: [now],
	})
	return result.rowsAffected
}

/**
 * Extend the lease on every running row owned by this executor. Called from
 * the dispatcher tick so the workflows in flight stay un-reclaimable as
 * long as the dispatcher loop is alive.
 */
export async function extendLeases(
	client: SqlClient,
	executorId: string,
	newExpiry: number
): Promise<void> {
	await client.execute({
		sql: `UPDATE _dc_workflow
			SET claim_expires_at = ?
			WHERE status = 'running' AND executor_id = ?`,
		args: [newExpiry, executorId],
	})
}

/** Update `_dc_executor.heartbeat_at` for ops visibility. */
export async function touchExecutorHeartbeat(
	client: SqlClient,
	executorId: string,
	now: number
): Promise<void> {
	await client.execute({
		sql: `UPDATE _dc_executor SET heartbeat_at = ? WHERE id = ?`,
		args: [now, executorId],
	})
}

/**
 * Atomically claim up to `limit` pending workflows whose `scheduled_for` has
 * passed, marking them `running` and assigning this executor. The claim
 * stamps `claim_expires_at = now + leaseMs`; the lease is extended by the
 * dispatcher's heartbeat tick while the workflow is in flight.
 *
 * `queueFilter`:
 *   - `undefined` — claim any queue (or no queue)
 *   - `null` — only rows with `queue IS NULL`
 *   - `string` — only rows whose `queue` equals the string
 */
export async function claimPending(
	client: SqlClient,
	executorId: string,
	now: number,
	leaseMs: number,
	limit: number,
	queueFilter?: string | null
): Promise<WorkflowRow[]> {
	const args: SqlBindable[] = [now]
	let queueClause = ''
	if (queueFilter === null) {
		queueClause = 'AND queue IS NULL'
	} else if (typeof queueFilter === 'string') {
		queueClause = 'AND queue = ?'
		args.push(queueFilter)
	}
	args.push(limit, executorId, now, now + leaseMs)
	const sql = `WITH next AS (
			SELECT id FROM _dc_workflow
			WHERE status = 'pending' AND scheduled_for <= ? ${queueClause}
			ORDER BY scheduled_for, created_at
			LIMIT ?
		)
		UPDATE _dc_workflow
		SET status = 'running',
		    executor_id = ?,
		    started_at = COALESCE(started_at, ?),
		    claim_expires_at = ?,
		    attempts = attempts + 1
		WHERE id IN (SELECT id FROM next)
		RETURNING *`
	const result = await client.execute({ sql, args })
	return result.rows.map(toWorkflowRow)
}

export async function finalizeWorkflow(
	client: SqlClient,
	workflowId: string,
	status: 'success' | 'error' | 'cancelled',
	endedAt: number,
	output?: string,
	error?: string
): Promise<void> {
	await client.execute({
		sql: `UPDATE _dc_workflow
			SET status = ?,
			    ended_at = ?,
			    output = ?,
			    error = ?,
			    executor_id = NULL,
			    claim_expires_at = NULL
			WHERE id = ?`,
		args: [status, endedAt, output ?? null, error ?? null, workflowId],
	})
}

export async function requeueWorkflow(
	client: SqlClient,
	workflowId: string,
	nextRunAt: number
): Promise<void> {
	await client.execute({
		sql: `UPDATE _dc_workflow
			SET status = 'pending',
			    executor_id = NULL,
			    started_at = NULL,
			    claim_expires_at = NULL,
			    scheduled_for = ?
			WHERE id = ?`,
		args: [nextRunAt, workflowId],
	})
}

/**
 * Build the prepared statement for inserting a `_dc_step` row. Exposed so
 * `ctx.txStep` can run the insert on a caller-provided transaction (same
 * SQL, different executor).
 */
export function buildInsertStepStatement(row: StepRow): SqlStatement {
	return {
		sql: `INSERT OR IGNORE INTO _dc_step
			(workflow_id, step_id, name, status, output, error, attempts, duration_ms, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			row.workflow_id,
			row.step_id,
			row.name,
			row.status,
			row.output,
			row.error,
			row.attempts,
			row.duration_ms,
			row.created_at,
		],
	}
}

export async function insertStepRow(
	client: SqlClient,
	row: StepRow
): Promise<void> {
	await client.execute(buildInsertStepStatement(row))
}

/**
 * Flag a cancellation request. `pending` rows transition straight to
 * `cancelled`; `running` rows have `cancel_requested_at` set so the worker
 * throws `DurableCancelledError` at the next step boundary.
 */
export async function requestCancel(
	client: SqlClient,
	workflowId: string,
	now: number
): Promise<'cancelled' | 'requested' | 'noop'> {
	const result = await client.execute({
		sql: `UPDATE _dc_workflow
			SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
			    cancel_requested_at = ?,
			    ended_at = CASE WHEN status = 'pending' THEN ? ELSE ended_at END
			WHERE id = ?
			  AND status IN ('pending','running')
			RETURNING status`,
		args: [now, now, workflowId],
	})
	const row = result.rows[0]
	if (!row) return 'noop'
	return row.status === 'cancelled' ? 'cancelled' : 'requested'
}
