// These have to be individual named imports so Rollup can trace specific
// dependencies. Importantly, we want to avoid the chain
// withSentry → sentrySolidStartVite.js → @sentry/vite-plugin → @babel/core
import {
	init,
	captureException as sdkCaptureException,
	captureMessage as sdkCaptureMessage,
	addIntegration,
	startSpan,
	withScope,
} from '@sentry/solidstart'
import type { CaptureContext, SeverityLevel } from '@sentry/solidstart'
import { clientEnv } from './env.client'
import isNetworkError from 'is-network-error'

const isServer = typeof window === 'undefined'
const environment = isServer ? 'server' : 'client'

function logError(error: unknown, context?: Record<string, unknown>): void {
	const timestamp = new Date().toISOString()
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

function logMessage(
	message: string,
	captureContext?: CaptureContext | SeverityLevel
): void {
	const level: SeverityLevel =
		typeof captureContext === 'string'
			? captureContext
			: typeof captureContext === 'object' &&
				  captureContext !== null &&
				  'level' in captureContext
				? ((captureContext as { level?: SeverityLevel }).level ?? 'info')
				: 'info'
	const logFn =
		level === 'error' || level === 'fatal'
			? console.error
			: level === 'warning'
				? console.warn
				: console.info
	logFn(`[${environment.toUpperCase()} ${level.toUpperCase()}]:`, {
		message,
		timestamp: new Date().toISOString(),
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
	init({
		dsn: clientEnv.sentryDsn,
		enabled: clientEnv.sentryEnabled,
		environment: clientEnv.sentryEnvironment ?? clientEnv.mode,
		release: clientEnv.sentryRelease,
		sampleRate: clientEnv.sentrySampleRate,
		tracesSampleRate: clientEnv.sentryTracesSampleRate,
		beforeSend(event, hint) {
			const err = hint.originalException
			if (isControlFlow(err)) return null

			// Mark network errors
			if (isNetworkError(err)) {
				event.extra = event.extra ?? {}
				event.extra.network = true

				// Downgrade network errors from the browser, where connectivity
				// is unreliable.
				if (!isServer) {
					event.level = 'info'
				}
			}

			logError(err, { sentryEventId: event.event_id })
			return event
		},
	})
}

/**
 * Thin wrapper around the Sentry SDK that ensures exceptions and messages are
 * always logged locally, even when Sentry reporting is disabled (e.g. in local
 * dev).
 *
 * When Sentry is active, beforeSend handles logging (and includes the
 * sentryEventId for correlation). When Sentry is inactive, the wrapper logs
 * directly to console.
 */
export const Sentry = {
	captureException(err: unknown, ctx?: CaptureContext): string {
		if (!isControlFlow(err) && !clientEnv.sentryEnabled) {
			logError(err)
		}

		return sdkCaptureException(err, ctx)
	},

	captureMessage(
		message: string,
		captureContext?: CaptureContext | SeverityLevel
	): string {
		if (!clientEnv.sentryEnabled) {
			logMessage(message, captureContext)
		}

		return sdkCaptureMessage(message, captureContext)
	},

	addIntegration,
	startSpan,
	withScope,
}
