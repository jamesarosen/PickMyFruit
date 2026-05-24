import {
	DurableCancelledError,
	ReplayedStepError,
	UnknownWorkflowError,
} from './errors.ts'
import { Metrics, type Telemetry } from './telemetry.server.ts'
import {
	decodePayload,
	encodePayload,
	finalizeWorkflow,
	insertStepRow,
	requeueWorkflow,
	selectStepsForWorkflow,
	selectWorkflowById,
	serializeError,
	type StepRow,
	type WorkflowRow,
} from './sql.server.ts'
import type { SqlClient, WorkflowContext } from './types.ts'
import type { WorkflowRegistry } from './registry.ts'

/** Stable step id for the Nth invocation of a step with `name`. */
function stepIdFor(name: string, sequence: number): string {
	return sequence === 0 ? name : `${name}#${sequence + 1}`
}

/**
 * Run a single dispatched workflow row to completion (or back to pending on a
 * retryable error). Returns the terminal status of this attempt — does not
 * throw on workflow-author errors; those are recorded on the row.
 */
export async function runWorkflow(
	client: SqlClient,
	registry: WorkflowRegistry,
	telemetry: Telemetry,
	row: WorkflowRow
): Promise<'success' | 'error' | 'cancelled' | 'requeued'> {
	const def = registry.getWorkflow(row.name)
	if (!def) {
		telemetry.captureException(new UnknownWorkflowError(row.name), {
			workflow: row.name,
		})
		await finalizeWorkflow(
			client,
			row.id,
			'error',
			Date.now(),
			undefined,
			encodePayload(serializeError(new UnknownWorkflowError(row.name)))
		)
		telemetry.count(Metrics.workflowFinished, {
			'workflow.name': row.name,
			queue: row.queue ?? 'none',
			status: 'error',
		})
		return 'error'
	}

	const existingSteps = await selectStepsForWorkflow(client, row.id)
	const stepCache = new Map<string, StepRow>(
		existingSteps.map((s) => [s.step_id, s])
	)
	if (existingSteps.length > 0) {
		telemetry.count(Metrics.workflowReplay, { 'workflow.name': row.name })
	}

	const callCounts = new Map<string, number>()

	const ctx: WorkflowContext = {
		workflowId: row.id,
		workflowName: row.name,
		attempt: row.attempts,
		now: () => row.started_at ?? row.created_at,
		stepKey(name: string) {
			return `${row.id}:${name}`
		},
		async step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
			const sequence = callCounts.get(name) ?? 0
			callCounts.set(name, sequence + 1)
			const stepId = stepIdFor(name, sequence)

			const cached = stepCache.get(stepId)
			if (cached) {
				telemetry.count(Metrics.stepReplayed, {
					'workflow.name': row.name,
					'step.name': name,
				})
				if (cached.status === 'success') {
					return decodePayload<T>(cached.output) as T
				}
				const parsed = decodePayload<{ message?: string }>(cached.error)
				throw new ReplayedStepError(name, parsed?.message ?? 'Replayed step error')
			}

			const fresh = await selectWorkflowById(client, row.id)
			if (fresh?.cancel_requested_at != null) {
				throw new DurableCancelledError(row.id)
			}

			telemetry.count(Metrics.stepStarted, {
				'workflow.name': row.name,
				'step.name': name,
			})
			const startedAt = Date.now()
			try {
				const value = await fn()
				const durationMs = Date.now() - startedAt
				const stepRow: StepRow = {
					workflow_id: row.id,
					step_id: stepId,
					name,
					status: 'success',
					output: encodePayload(value),
					error: null,
					attempts: 1,
					duration_ms: durationMs,
					created_at: Date.now(),
				}
				await insertStepRow(client, stepRow)
				stepCache.set(stepId, stepRow)
				telemetry.count(Metrics.stepFinished, {
					'workflow.name': row.name,
					'step.name': name,
				})
				telemetry.distribution(Metrics.stepDurationMs, durationMs, {
					'workflow.name': row.name,
					'step.name': name,
				})
				return value
			} catch (err) {
				const durationMs = Date.now() - startedAt
				const serialized = serializeError(err)
				const stepRow: StepRow = {
					workflow_id: row.id,
					step_id: stepId,
					name,
					status: 'error',
					output: null,
					error: encodePayload(serialized),
					attempts: 1,
					duration_ms: durationMs,
					created_at: Date.now(),
				}
				await insertStepRow(client, stepRow)
				stepCache.set(stepId, stepRow)
				telemetry.count(Metrics.stepFailed, {
					'workflow.name': row.name,
					'step.name': name,
				})
				telemetry.captureException(err, { workflow: row.name, step: name })
				throw err
			}
		},
	}

	const input = decodePayload(row.input)

	try {
		const output = await def.fn(ctx, input)
		await finalizeWorkflow(
			client,
			row.id,
			'success',
			Date.now(),
			encodePayload(output)
		)
		telemetry.count(Metrics.workflowFinished, {
			'workflow.name': row.name,
			queue: row.queue ?? 'none',
			status: 'success',
		})
		return 'success'
	} catch (err) {
		if (err instanceof DurableCancelledError) {
			await finalizeWorkflow(
				client,
				row.id,
				'cancelled',
				Date.now(),
				undefined,
				encodePayload(serializeError(err))
			)
			telemetry.count(Metrics.workflowFinished, {
				'workflow.name': row.name,
				queue: row.queue ?? 'none',
				status: 'cancelled',
			})
			return 'cancelled'
		}

		const canRetry = row.attempts < row.max_attempts
		if (canRetry) {
			const backoffMs = Math.min(60_000, 250 * 2 ** row.attempts)
			await requeueWorkflow(client, row.id, Date.now() + backoffMs)
			telemetry.warn(
				{
					workflowId: row.id,
					name: row.name,
					attempt: row.attempts,
					nextAttempt: row.attempts + 1,
					backoffMs,
				},
				'workflow.requeue'
			)
			return 'requeued'
		}

		await finalizeWorkflow(
			client,
			row.id,
			'error',
			Date.now(),
			undefined,
			encodePayload(serializeError(err))
		)
		telemetry.count(Metrics.workflowFinished, {
			'workflow.name': row.name,
			queue: row.queue ?? 'none',
			status: 'error',
		})
		telemetry.captureException(err, { workflow: row.name })
		return 'error'
	}
}
