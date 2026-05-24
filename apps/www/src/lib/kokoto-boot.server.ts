import { libsqlClient } from '@/data/db.server'
import {
	runtime,
	type RuntimeStartOptions,
} from '@pickmyfruit/kokoto/runtime.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'

/** Starts the kokoto durable runtime after migrations complete. */
export async function startKokotoRuntime(): Promise<void> {
	const sentry = {
		metrics: Sentry.metrics,
		startSpan: Sentry.startSpan,
		captureException: Sentry.captureException,
		addBreadcrumb: Sentry.addBreadcrumb,
	} as NonNullable<RuntimeStartOptions['sentry']>

	await runtime.start({
		client: libsqlClient,
		queues: [],
		workflows: [],
		sentry,
		logger,
	})
}
