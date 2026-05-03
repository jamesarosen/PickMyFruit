/**
 * Thin Sentry wrapper for the photo-transform service.
 *
 * Reads `SENTRY_DSN` from the environment. When the DSN is absent (dev / test)
 * `initSentry` is a no-op so the service runs without a real Sentry project.
 *
 * Import `captureException` from here instead of directly from `@sentry/node`
 * so call-sites are not coupled to the SDK and behave correctly when Sentry is
 * not initialised.
 */
import * as Sentry from "@sentry/node";

/** Initialise Sentry. No-ops when `SENTRY_DSN` is absent or in test mode. */
export function initSentry(): void {
	// Never initialise Sentry in the test environment — it would interfere with
	// OTel provider setup controlled by the test harness.
	if (process.env["NODE_ENV"] === "test") return;

	const dsn = process.env["SENTRY_DSN"];
	if (!dsn) return;

	Sentry.init({
		dsn,
		tracesSampleRate: 1.0,
		// The OTel provider is managed by tracing.ts, which wires SentrySpanProcessor
		// manually. Tell Sentry not to set up its own OTel provider.
		skipOpenTelemetrySetup: true,
	});
}

/** Capture an exception to Sentry (no-op when Sentry is not initialised). */
export const captureException = Sentry.captureException;
