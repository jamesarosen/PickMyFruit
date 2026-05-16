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
import {
	createResendUpsert,
	findNewsletterTopicId,
	type ResendUpsert,
} from "./resend-client.js";
import { createTokenBucket } from "./token-bucket.js";

/** EX_CONFIG (sysexits.h 78): configuration error — distinct from shell 1/2. */
const EXIT_CONFIG_ERROR = 78;
import { runCycle } from "./run-cycle.js";

const envResult = parseWorkerEnv(process.env);
if (!envResult.ok) {
	// Initialize Sentry from whatever DSN we can recover so the validation
	// failure isn't lost. process.env.SENTRY_DSN bypasses our own parser, but
	// if it's a syntactic mess Sentry's init will simply no-op.
	initSentry({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT ?? "resend-sync",
		release: process.env.SENTRY_RELEASE,
	});
	logger.fatal(
		{ issues: envResult.error.issues },
		"resend-sync: env validation failed; exiting",
	);
	Sentry.captureException(new Error(envResult.error.message), {
		fingerprint: ["resend-sync", "env-validation-failed"],
		extra: { issues: envResult.error.issues },
	});
	// Give Sentry a brief window to flush before exit. close() resolves once
	// the queue drains or its own timeout fires.
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}

const env = envResult.env;

initSentry({
	dsn: env.SENTRY_DSN,
	environment: env.SENTRY_ENVIRONMENT,
	release: env.SENTRY_RELEASE,
});

// Keep-alive across upserts so a backfill reuses connections instead of opening
// a new TCP+TLS handshake per row.
const dispatcher = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 300_000,
});

const internal = createInternalApiClient({
	baseUrl: env.INTERNAL_API_URL,
	secret: env.INTERNAL_API_SECRET,
	dispatcher,
});

if (env.provider.RESEND_SYNC_PROVIDER === "disabled") {
	// `disabled` means RESEND_API_KEY was not provided. Silently advancing the
	// cursor without syncing would corrupt the state — contacts skipped here are
	// never retried. Fail fast so misconfiguration is visible immediately.
	const err = new Error(
		"resend-sync: RESEND_SYNC_PROVIDER=disabled — set RESEND_SYNC_PROVIDER=resend and supply RESEND_API_KEY",
	);
	logger.fatal({ provider: "disabled" }, err.message);
	Sentry.captureException(err, {
		fingerprint: ["resend-sync", "missing-api-key"],
	});
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(EXIT_CONFIG_ERROR);
}

const topicId = await findNewsletterTopicId({
	apiKey: env.provider.RESEND_API_KEY,
	dispatcher,
});
if (!topicId) {
	logger.fatal(
		{ apiUrl: env.INTERNAL_API_URL },
		'resend-sync: "Newsletter" topic not found in Resend; exiting',
	);
	Sentry.captureException(new Error('Resend "Newsletter" topic not found'), {
		fingerprint: ["resend-sync", "newsletter-topic-not-found"],
	});
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(EXIT_CONFIG_ERROR);
}

const resend: ResendUpsert = createResendUpsert({
	apiKey: env.provider.RESEND_API_KEY,
	topicId,
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
		provider: env.provider.RESEND_SYNC_PROVIDER,
		internalApiUrl: env.INTERNAL_API_URL,
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
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}
