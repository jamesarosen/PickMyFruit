import * as Sentry from '@sentry/solidstart'
import { clientEnv } from './env.client'

function logError(error: unknown, context?: Record<string, unknown>): void {
	const timestamp = new Date().toISOString()
	const isServer = typeof window === 'undefined'
	const environment = isServer ? 'server' : 'client'

	console.error(`[${environment.toUpperCase()} ERROR]:`, {
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
		timestamp,
		...context,
	})
}

if (clientEnv.sentryDsn) {
	Sentry.init({
		dsn: clientEnv.sentryDsn,
		enabled: clientEnv.sentryEnabled,
		environment: clientEnv.mode,
		tracesSampleRate: 1.0,
		beforeSend(event, hint) {
			logError(hint.originalException, {
				sentryEventId: event.event_id,
			})
			return event
		},
	})
}

export { Sentry }
