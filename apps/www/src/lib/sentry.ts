// These have to be individual named imports so Rollup can trace specific
// dependencies. Importantly, we want to avoid the chain
// withSentry → sentrySolidStartVite.js → @sentry/vite-plugin → @babel/core
import {
	init,
	captureException as sdkCaptureException,
	captureMessage as sdkCaptureMessage,
	addBreadcrumb,
	addIntegration,
	metrics,
	startSpan,
	withScope,
} from '@sentry/solidstart'
import type {
	Breadcrumb,
	CaptureContext,
	SeverityLevel,
} from '@sentry/solidstart'
import { clientEnv } from './env'
import isNetworkError from 'is-network-error'

// The serialized span shape `beforeSendSpan` receives; the SDK does not
// re-export its `SpanJSON` type, so derive it from the option's signature.
type SpanJSON = Parameters<
	NonNullable<NonNullable<Parameters<typeof init>[0]>['beforeSendSpan']>
>[0]

// Query strings on these hosts carry user-typed addresses or the user's raw
// coordinates (geocoding, suggestions, reverse geocoding). They must never
// reach Sentry, where they would ride along on error events and traces.
const GEO_SERVICE_HOSTS = new Set([
	'photon.komoot.io',
	'nominatim.openstreetmap.org',
])

/**
 * Strips the query string from geocoding-service URLs; all other strings are
 * returned untouched.
 */
export function redactGeoServiceUrl(url: string): string {
	try {
		const parsed = new URL(url)
		if (GEO_SERVICE_HOSTS.has(parsed.hostname)) {
			return parsed.origin + parsed.pathname
		}
	} catch {
		// Relative URL or not a URL at all — nothing to redact.
	}
	return url
}

/**
 * Redacts geocoding-service URLs in a breadcrumb. The SDK's default fetch
 * instrumentation records every request's full URL in `data.url`.
 */
export function redactGeoBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
	if (typeof breadcrumb.data?.url === 'string') {
		breadcrumb.data.url = redactGeoServiceUrl(breadcrumb.data.url)
	}
	return breadcrumb
}

/**
 * Redacts geocoding-service URLs in a span. Browser tracing's fetch
 * instrumentation stores the full URL in the span name/description and in
 * the `http.url`/`url.full`/`http.query` attributes.
 */
export function redactGeoSpan(span: SpanJSON): SpanJSON {
	let touchesGeoService = false
	if (span.data) {
		// Browser fetch spans carry the full URL in `url` and `http.url`
		// (see @sentry/core's getFetchSpanAttributes); server-side HTTP
		// instrumentation uses `url.full`.
		for (const key of ['url', 'http.url', 'url.full'] as const) {
			const value = span.data[key]
			if (typeof value !== 'string') continue
			const redacted = redactGeoServiceUrl(value)
			if (redacted !== value) {
				span.data[key] = redacted
				touchesGeoService = true
			}
		}
		// The standalone query/fragment attributes would undo the redaction.
		if (touchesGeoService) {
			delete span.data['http.query']
			delete span.data['url.query']
			delete span.data['http.fragment']
		}
	}
	if (typeof span.description === 'string') {
		span.description = span.description.replace(
			/https?:\/\/\S+/g,
			(url: string) => redactGeoServiceUrl(url)
		)
	}
	return span
}

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
		beforeBreadcrumb(breadcrumb) {
			// Strip the internal shared secret from any breadcrumb that may have
			// captured request headers (fetch, http, console). Defense-in-depth on
			// top of the logger's redaction list.
			const data = breadcrumb.data as Record<string, unknown> | undefined
			if (data && typeof data === 'object') {
				const headers = data['headers'] ?? data['requestHeaders']
				if (headers && typeof headers === 'object') {
					for (const key of Object.keys(headers as Record<string, unknown>)) {
						if (key.toLowerCase() === 'x-internal-auth') {
							;(headers as Record<string, unknown>)[key] = '[Redacted]'
						}
					}
				}
			}
			return redactGeoBreadcrumb(breadcrumb)
		},
		beforeSendSpan: redactGeoSpan,
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

	addBreadcrumb,
	addIntegration,
	metrics,
	startSpan,
	withScope,
}
