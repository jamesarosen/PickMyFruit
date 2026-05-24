import {
	createRuntime,
	defineQueue,
	type RuntimeTelemetry,
} from '@pickmyfruit/kokoto'
import { client } from '@/data/db.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'

export const emailQueue = defineQueue('email', { concurrency: 4 })
export const mediaQueue = defineQueue('media', { concurrency: 1 })
export const resendQueue = defineQueue('resend', { concurrency: 2 })

const telemetry: RuntimeTelemetry = {
	increment(metric, attributes) {
		Sentry.metrics.count(metric, 1, { attributes })
	},
	distribution(metric, value, attributes) {
		Sentry.metrics.distribution(metric, value, { attributes })
	},
	captureException(error, context) {
		Sentry.captureException(error, { extra: context })
	},
	addBreadcrumb(breadcrumb) {
		Sentry.addBreadcrumb(breadcrumb)
	},
}

export const runtime = createRuntime({
	client,
	logger,
	telemetry,
})

let startPromise: Promise<void> | undefined

/** Starts the kokoto runtime once for this server process. */
export function startKokotoRuntime(): Promise<void> {
	startPromise ??= runtime.start({
		queues: [emailQueue, mediaQueue, resendQueue],
		workflows: [],
	})
	return startPromise
}

/** Stops the kokoto runtime and waits for in-flight workflows to settle. */
export async function stopKokotoRuntime(): Promise<void> {
	await runtime.stop()
	startPromise = undefined
}
