import * as Sentry from '@sentry/solidstart'
import { z } from 'zod'

const isProd = import.meta.env.PROD

const sentryConfigSchema = z
	.object({
		VITE_SENTRY_DSN: z.url(),
		VITE_SENTRY_ENABLED: z
			.enum(['true', 'false'])
			.transform((v) => v === 'true')
			.optional(),
	})
	.transform((data) => ({
		dsn: data.VITE_SENTRY_DSN,
		// In prod: default to true (reporting on)
		// In other envs: default to false (reporting off, opt-in for testing)
		enabled: data.VITE_SENTRY_ENABLED ?? isProd,
	}))
	.refine((data) => !isProd || data.enabled !== false, {
		message: 'VITE_SENTRY_ENABLED cannot be false in production',
	})

const config = sentryConfigSchema.parse(import.meta.env)

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

Sentry.init({
	dsn: config.dsn,
	enabled: config.enabled,
	environment: import.meta.env.MODE,
	tracesSampleRate: 1.0,
	beforeSend(event, hint) {
		logError(hint.originalException, { sentryEventId: event.event_id })
		return event
	},
})

export { Sentry }
