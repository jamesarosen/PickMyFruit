import type { Client } from "@libsql/client";
import { serializePayload } from "./json.server.js";
import type { StepRow, WorkflowRow, WorkflowStatus } from "./types.server.js";
import { DEFAULT_MAX_ATTEMPTS, PROTOCOL_VERSION } from "./types.server.js";

function rowToWorkflow(row: Record<string, unknown>): WorkflowRow {
	return row as unknown as WorkflowRow;
}

function rowToStep(row: Record<string, unknown>): StepRow {
	return row as unknown as StepRow;
}

/** Inserts a pending workflow row, respecting idempotency key deduplication. */
export async function insertWorkflow(
	client: Client,
	options: {
		id: string;
		name: string;
		input: unknown;
		queue?: string;
		idempotencyKey?: string;
		scheduledFor?: number;
		maxAttempts?: number;
	},
): Promise<{ id: string; created: boolean }> {
	const now = Date.now();
	const input = serializePayload(options.input);
	const scheduledFor = options.scheduledFor ?? 0;
	const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

	if (options.idempotencyKey) {
		await client.execute({
			sql: `INSERT INTO _dc_workflow (
				id, name, status, queue, input, attempts, max_attempts,
				scheduled_for, created_at, idempotency_key, protocol_version
			) VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, ?)
			ON CONFLICT(idempotency_key) DO NOTHING`,
			args: [
				options.id,
				options.name,
				options.queue ?? null,
				input,
				maxAttempts,
				scheduledFor,
				now,
				options.idempotencyKey,
				PROTOCOL_VERSION,
			],
		});
		const existing = await client.execute({
			sql: "SELECT id FROM _dc_workflow WHERE idempotency_key = ?",
			args: [options.idempotencyKey],
		});
		const id = String(existing.rows[0]?.id);
		return { id, created: id === options.id };
	}

	await client.execute({
		sql: `INSERT INTO _dc_workflow (
			id, name, status, queue, input, attempts, max_attempts,
			scheduled_for, created_at, protocol_version
		) VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?)`,
		args: [
			options.id,
			options.name,
			options.queue ?? null,
			input,
			maxAttempts,
			scheduledFor,
			now,
			PROTOCOL_VERSION,
		],
	});
	return { id: options.id, created: true };
}

/** Loads a workflow row by id. */
export async function getWorkflow(
	client: Client,
	id: string,
): Promise<WorkflowRow | undefined> {
	const result = await client.execute({
		sql: "SELECT * FROM _dc_workflow WHERE id = ?",
		args: [id],
	});
	if (result.rows.length === 0) return undefined;
	return rowToWorkflow(result.rows[0] as Record<string, unknown>);
}

/** Lists pending workflow ids eligible for dispatch (read-only). */
export async function listPendingWorkflowIds(
	client: Client,
	options: { now: number; limit: number },
): Promise<string[]> {
	const result = await client.execute({
		sql: `SELECT id FROM _dc_workflow
			WHERE status = 'pending' AND scheduled_for <= ?
			ORDER BY scheduled_for ASC, created_at ASC
			LIMIT ?`,
		args: [options.now, options.limit],
	});
	return result.rows.map((r) => String(r.id));
}

/** Claims specific workflow ids inside an IMMEDIATE transaction. */
export async function claimWorkflowIds(
	client: Client,
	options: { executorId: string; ids: string[] },
): Promise<WorkflowRow[]> {
	if (options.ids.length === 0) return [];

	const tx = await client.transaction("write");
	try {
		const claimed: WorkflowRow[] = [];
		const startedAt = Date.now();
		for (const id of options.ids) {
			const updated = await tx.execute({
				sql: `UPDATE _dc_workflow SET
					status = 'running',
					executor_id = ?,
					started_at = ?,
					attempts = attempts + 1
				WHERE id = ? AND status = 'pending'`,
				args: [options.executorId, startedAt, id],
			});
			if ((updated.rowsAffected ?? 0) === 0) continue;
			const loaded = await tx.execute({
				sql: "SELECT * FROM _dc_workflow WHERE id = ?",
				args: [id],
			});
			if (loaded.rows.length > 0) {
				claimed.push(rowToWorkflow(loaded.rows[0] as Record<string, unknown>));
			}
		}
		await tx.commit();
		return claimed;
	} catch (err) {
		await tx.rollback();
		throw err;
	} finally {
		tx.close();
	}
}

/** Marks a workflow terminal with output or error JSON. */
export async function finalizeWorkflow(
	client: Client,
	options: {
		id: string;
		status: Extract<WorkflowStatus, "success" | "error" | "cancelled">;
		output?: unknown;
		error?: unknown;
	},
): Promise<void> {
	const endedAt = Date.now();
	await client.execute({
		sql: `UPDATE _dc_workflow SET
			status = ?,
			output = ?,
			error = ?,
			ended_at = ?,
			executor_id = NULL
		WHERE id = ?`,
		args: [
			options.status,
			options.output === undefined ? null : serializePayload(options.output),
			options.error === undefined ? null : serializePayload(options.error),
			endedAt,
			options.id,
		],
	});
}

/** Sets cancel_requested_at for a running workflow. */
export async function requestCancelRunning(
	client: Client,
	id: string,
): Promise<boolean> {
	const now = Date.now();
	const result = await client.execute({
		sql: `UPDATE _dc_workflow SET cancel_requested_at = ?
			WHERE id = ? AND status = 'running'`,
		args: [now, id],
	});
	return (result.rowsAffected ?? 0) > 0;
}

/** Cancels a pending workflow immediately. */
export async function cancelPending(
	client: Client,
	id: string,
): Promise<boolean> {
	const result = await client.execute({
		sql: `UPDATE _dc_workflow SET status = 'cancelled', ended_at = ?
			WHERE id = ? AND status = 'pending'`,
		args: [Date.now(), id],
	});
	return (result.rowsAffected ?? 0) > 0;
}

/** Requeues foreign running workflows whose executor heartbeat is stale. */
export async function recoverStaleWorkflows(
	client: Client,
	options: { executorId: string; staleBeforeMs: number },
): Promise<string[]> {
	const result = await client.execute({
		sql: `UPDATE _dc_workflow SET
			status = 'pending',
			executor_id = NULL,
			started_at = NULL
		WHERE status = 'running'
			AND executor_id IS NOT NULL
			AND executor_id != ?
			AND executor_id IN (
				SELECT id FROM _dc_executor WHERE heartbeat_at < ?
			)
		RETURNING name`,
		args: [options.executorId, options.staleBeforeMs],
	});
	return result.rows.map((r) => String(r.name));
}

/** Requeues all running rows not owned by this executor (boot reclaim). */
export async function recoverForeignRunning(
	client: Client,
	executorId: string,
): Promise<Array<{ id: string; name: string }>> {
	const result = await client.execute({
		sql: `UPDATE _dc_workflow SET
			status = 'pending',
			executor_id = NULL,
			started_at = NULL
		WHERE status = 'running' AND (executor_id IS NULL OR executor_id != ?)
		RETURNING id, name`,
		args: [executorId],
	});
	return result.rows.map((r) => ({
		id: String(r.id),
		name: String(r.name),
	}));
}

export async function insertExecutor(
	client: Client,
	id: string,
): Promise<void> {
	const now = Date.now();
	await client.execute({
		sql: "INSERT INTO _dc_executor (id, started_at, heartbeat_at) VALUES (?, ?, ?)",
		args: [id, now, now],
	});
}

export async function touchExecutorHeartbeat(
	client: Client,
	executorId: string,
): Promise<void> {
	await client.execute({
		sql: "UPDATE _dc_executor SET heartbeat_at = ? WHERE id = ?",
		args: [Date.now(), executorId],
	});
}

export async function runQuickCheck(client: Client): Promise<boolean> {
	const result = await client.execute("PRAGMA quick_check");
	const row = result.rows[0];
	if (!row) return false;
	const key = Object.keys(row)[0];
	return key ? String(row[key]) === "ok" : false;
}

export async function getStep(
	client: Client,
	workflowId: string,
	stepId: string,
): Promise<StepRow | undefined> {
	const result = await client.execute({
		sql: "SELECT * FROM _dc_step WHERE workflow_id = ? AND step_id = ?",
		args: [workflowId, stepId],
	});
	if (result.rows.length === 0) return undefined;
	return rowToStep(result.rows[0] as Record<string, unknown>);
}

export async function upsertStepSuccess(
	client: Client,
	options: {
		workflowId: string;
		stepId: string;
		output: unknown;
	},
): Promise<void> {
	const now = Date.now();
	const output = serializePayload(options.output);
	await client.execute({
		sql: `INSERT INTO _dc_step (
			workflow_id, step_id, status, output, attempts, created_at, ended_at
		) VALUES (?, ?, 'success', ?, 1, ?, ?)
		ON CONFLICT(workflow_id, step_id) DO UPDATE SET
			status = 'success',
			output = excluded.output,
			ended_at = excluded.ended_at`,
		args: [options.workflowId, options.stepId, output, now, now],
	});
}

export async function upsertStepError(
	client: Client,
	options: {
		workflowId: string;
		stepId: string;
		error: unknown;
	},
): Promise<void> {
	const now = Date.now();
	const error = serializePayload(
		options.error instanceof Error
			? { message: options.error.message, name: options.error.name }
			: options.error,
	);
	await client.execute({
		sql: `INSERT INTO _dc_step (
			workflow_id, step_id, status, error, attempts, created_at, ended_at
		) VALUES (?, ?, 'error', ?, 1, ?, ?)
		ON CONFLICT(workflow_id, step_id) DO UPDATE SET
			status = 'error',
			error = excluded.error,
			ended_at = excluded.ended_at`,
		args: [options.workflowId, options.stepId, error, now, now],
	});
}
