import { defineQueue } from '@pickmyfruit/kokoto'
import type { KokotoTelemetry } from '@pickmyfruit/kokoto'
import {
	createRuntime,
	type DurableRuntime,
} from '@pickmyfruit/kokoto/runtime.server'
import { libsqlClient } from '@/data/db.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'

/**
 * Default queues — kept in sync with what workflows register against via
 * `defineWorkflow(..., { queue: '...' })`. Concurrency caps are conservative
 * starting points; tune once we see real traffic.
 */
export const emailQueue = defineQueue('email', { concurrency: 4 })
export const mediaQueue = defineQueue('media', { concurrency: 1 })
export const resendQueue = defineQueue('resend', { concurrency: 2 })

let runtimeInstance: DurableRuntime | undefined

/** Build the runtime telemetry adapter — Sentry metrics + pino logs. */
function buildTelemetry(): KokotoTelemetry {
	return {
		incrementCounter: (name, value, attrs) => {
			Sentry.metrics.count(name, value, {
				attributes: attrs as Record<string, string | number>,
			})
		},
		recordDistribution: (name, value, attrs) => {
			Sentry.metrics.distribution(name, value, {
				attributes: attrs as Record<string, string | number>,
			})
		},
		captureException: (err, ctx) => {
			Sentry.captureException(err, {
				tags: (ctx ?? {}) as Record<string, string>,
				fingerprint: ['kokoto', ctx?.workflow ?? 'unknown', ctx?.step ?? ''],
			})
		},
		logInfo: (fields, msg) => logger.info(fields, msg),
		logDebug: (fields, msg) => logger.debug(fields, msg),
		logWarn: (fields, msg) => logger.warn(fields, msg),
	}
}

/**
 * Lazily-initialized runtime singleton. Workflow registration happens inside
 * `startRuntime()` so callers do not have to thread the runtime through.
 */
export function getRuntime(): DurableRuntime {
	if (!runtimeInstance) {
		runtimeInstance = createRuntime({
			client: libsqlClient,
			telemetry: buildTelemetry(),
			pollMs: 250,
			globalConcurrency: 16,
		})
	}
	return runtimeInstance
}

let startPromise: Promise<DurableRuntime> | undefined

/**
 * Start the runtime exactly once per boot. Idempotent — safe to call multiple
 * times in the same process; only the first call registers workflows and
 * starts the dispatcher.
 */
export function startRuntime(): Promise<DurableRuntime> {
	startPromise ??= (async () => {
		const runtime = getRuntime()
		await runtime.start({
			workflows: [],
			queues: [emailQueue, mediaQueue, resendQueue],
		})
		return runtime
	})()
	return startPromise
}

/** Stop the runtime — bound to SIGTERM/SIGINT handlers elsewhere. */
export async function stopRuntime(): Promise<void> {
	if (!runtimeInstance) return
	await runtimeInstance.stop()
}
