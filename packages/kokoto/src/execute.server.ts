import type { Client } from "@libsql/client";
import { WorkflowContext } from "./context.server.js";
import { DurableCancelledError } from "./errors.server.js";
import { parsePayload } from "./json.server.js";
import { getWorkflowDefinition } from "./registry.server.js";
import * as store from "./store.server.js";
import {
	recordWorkflowFinished,
	recordWorkflowReplay,
} from "./telemetry.server.js";
import type { WorkflowRow } from "./types.server.js";

/** Runs a claimed workflow to completion, finalizing status in SQLite. */
export async function executeWorkflow(
	client: Client,
	row: WorkflowRow,
	options: { isReplay?: boolean },
): Promise<void> {
	const definition = getWorkflowDefinition(row.name);
	if (!definition) {
		await store.finalizeWorkflow(client, {
			id: row.id,
			status: "error",
			error: { message: `Unknown workflow: ${row.name}` },
		});
		recordWorkflowFinished(row.name, row.queue ?? undefined, "error");
		return;
	}

	if (options.isReplay) {
		recordWorkflowReplay(row.name);
	}

	const input = parsePayload(row.input);
	const ctx = new WorkflowContext(client, {
		workflowId: row.id,
		workflowName: row.name,
		startedAtMs: row.started_at ?? row.created_at,
		cancelRequestedAt: row.cancel_requested_at,
	});

	try {
		const output = await definition.handler(ctx, input);
		await ctx.drainActiveSteps();
		await store.finalizeWorkflow(client, {
			id: row.id,
			status: "success",
			output,
		});
		recordWorkflowFinished(row.name, row.queue ?? undefined, "success");
	} catch (err) {
		await ctx.drainActiveSteps();
		if (err instanceof DurableCancelledError) {
			await store.finalizeWorkflow(client, {
				id: row.id,
				status: "cancelled",
			});
			recordWorkflowFinished(row.name, row.queue ?? undefined, "cancelled");
			return;
		}
		const attempts = row.attempts;
		if (attempts < row.max_attempts) {
			await client.execute({
				sql: `UPDATE _dc_workflow SET
					status = 'pending',
					executor_id = NULL,
					started_at = NULL,
					error = ?
				WHERE id = ?`,
				args: [
					JSON.stringify({
						message: err instanceof Error ? err.message : String(err),
					}),
					row.id,
				],
			});
			return;
		}
		await store.finalizeWorkflow(client, {
			id: row.id,
			status: "error",
			error: err instanceof Error ? { message: err.message } : err,
		});
		recordWorkflowFinished(row.name, row.queue ?? undefined, "error");
	}
}
