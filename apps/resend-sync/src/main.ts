/**
 * Entry point for the resend-sync worker.
 *
 * Runs as a separate Fly process group on the same machine as apps/www,
 * sharing the volume at /app/data. Wakes on RESEND_SYNC_POLL_MS, drains the
 * user queue, then sleeps. SIGTERM/SIGINT finish the in-flight row, write
 * the cursor, and exit 0.
 *
 * See docs/0007-resend-sync-cron.md.
 */
import { Agent } from "undici";
import { parseWorkerEnv } from "./env.js";
import { initSentry, Sentry } from "./sentry.js";
import { logger } from "./logger.js";
import { createInternalApiClient } from "./internal-api-client.js";
import { createResendUpsert } from "./resend-client.js";
import { createTokenBucket } from "./token-bucket.js";
import { runCycle } from "./run-cycle.js";

const env = parseWorkerEnv(process.env);

initSentry({
	dsn: env.SENTRY_DSN,
	environment: env.SENTRY_ENVIRONMENT,
	release: env.SENTRY_RELEASE,
});

// Keep-alive across upserts so a backfill reuses connections instead of opening
// a new TCP+TLS handshake per row. Hostname-pinned via undici Agent.
const dispatcher = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 300_000,
});

const internal = createInternalApiClient({
	baseUrl: env.INTERNAL_API_URL,
	secret: env.INTERNAL_API_SECRET,
	dispatcher,
});

const resend = createResendUpsert({
	apiKey: env.RESEND_API_KEY,
	audienceId: env.RESEND_AUDIENCE_ID,
	dispatcher,
});

const bucket = createTokenBucket({
	ratePerSec: env.RESEND_API_RATE_PER_SEC,
	capacity: env.RESEND_API_BUCKET_CAPACITY,
});

const controller = new AbortController();

function shutdown(signal: string): void {
	logger.info({ signal }, "resend-sync: shutdown signal received");
	controller.abort();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true },
		);
	});
}

logger.info(
	{
		pollMs: env.RESEND_SYNC_POLL_MS,
		cursorPath: env.RESEND_SYNC_CURSOR_PATH,
		ratePerSec: env.RESEND_API_RATE_PER_SEC,
	},
	"resend-sync: starting",
);

try {
	while (!controller.signal.aborted) {
		// eslint-disable-next-line no-await-in-loop -- each cycle must commit before sleeping.
		await runCycle({
			internal,
			resend,
			bucket,
			cursorPath: env.RESEND_SYNC_CURSOR_PATH,
			signal: controller.signal,
		});
		if (controller.signal.aborted) break;
		// eslint-disable-next-line no-await-in-loop
		await sleepWithAbort(env.RESEND_SYNC_POLL_MS, controller.signal);
	}
	logger.info("resend-sync: shutting down");
} catch (err) {
	Sentry.captureException(err);
	logger.error({ err }, "resend-sync: fatal error");
	process.exit(1);
}
