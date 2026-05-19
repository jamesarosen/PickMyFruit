import * as Sentry from "@sentry/node";

let initialized = false;

/**
 * Initializes @sentry/node for the worker process. Idempotent. Issues are
 * tagged with `process=resend-sync` so they filter cleanly from web
 * errors that share the same DSN.
 *
 * Uses SENTRY_DSN (NOT VITE_SENTRY_DSN) — this is a plain Node binary, not a
 * Vite bundle, so import.meta.env shimming doesn't apply.
 */
export function initSentry(config: Sentry.NodeOptions): void {
	if (initialized) return;
	if (!config.dsn) {
		initialized = true;
		return;
	}
	Sentry.setTag("process", "resend-sync");
	Sentry.init(config);
	initialized = true;
}

export { Sentry };
