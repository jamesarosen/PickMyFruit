import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initializes @sentry/node for the worker process. Idempotent. Issues are
 * tagged with `environment: 'resend-sync'` so they filter cleanly from web
 * errors that share the same DSN.
 *
 * Uses SENTRY_DSN (NOT VITE_SENTRY_DSN) — this is a plain Node binary, not a
 * Vite bundle, so import.meta.env shimming doesn't apply.
 */
export function initSentry(config: {
	dsn?: string;
	environment?: string;
	release?: string;
}): void {
	if (initialized) return;
	if (!config.dsn) {
		initialized = true;
		return;
	}
	Sentry.init({
		dsn: config.dsn,
		environment: config.environment ?? "resend-sync",
		release: config.release,
	});
	initialized = true;
}

export { Sentry };
