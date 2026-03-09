import * as Sentry from '@sentry/solidstart'
import { clientEnv } from './env.client'

function logError(error: unknown, context?: Record<string, unknown>): void {
	const timestamp = new Date().toISOString()
	const isServer = typeof window === 'undefined'
	const environment = isServer ? 'server' : 'client'

	// console.error is intentional here — this module runs on both client and server
	// and cannot depend on Pino (a Node.js-only library). This is the designated
	// exception handler; all other code should use Sentry.captureException instead.
	console.error(`[${environment.toUpperCase()} ERROR]:`, {
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
		timestamp,
		...context,
	})
}

/**
 * Tanstack uses `throw redirect(...)` for control flow. These are control-flow,
 * not exceptions, so Sentry doesn't need to know about them.
 */
function isControlFlow(cause: unknown): boolean {
	return !!(
		cause instanceof Response || (cause as Record<string, unknown>)?.isRedirect
	)
}

if (clientEnv.sentryDsn) {
	Sentry.init({
		dsn: clientEnv.sentryDsn,
		enabled: clientEnv.sentryEnabled,
		environment: clientEnv.mode,
		sampleRate: clientEnv.sentrySampleRate,
		tracesSampleRate: clientEnv.sentryTracesSampleRate,
		beforeSend(event, hint) {
			const err = hint.originalException
			if (isControlFlow(err)) return null

			logError(err, { sentryEventId: event.event_id })
			return event
		},
	})
}

export { Sentry }
