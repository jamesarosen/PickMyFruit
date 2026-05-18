/**
 * Entry point for the resend-sync worker.
 *
 * Long-lived process. In production, spawned as a child of the `app` web
 * server (see `apps/www/src/lib/spawn-resend-sync.server.ts`) on the same
 * Fly machine, sharing the volume at /app/data. Wakes on `RESEND_SYNC_POLL_MS`,
 * drains the user queue, sleeps. SIGTERM/SIGINT finish the in-flight row,
 * write the cursor, and exit 0.
 *
 * Gated by `RESEND_SYNC_WORKER_ENABLED` (default false). When disabled, exits
 * 0 immediately so a misconfigured spawn or a stray `pnpm dev` invocation
 * doesn't quietly burn API calls.
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
import { runCycle } from "./run-cycle.js";
import { createTokenBucket } from "./token-bucket.js";

/** EX_CONFIG (sysexits.h 78): configuration error — distinct from shell 1/2. */
const EXIT_CONFIG_ERROR = 78;

const envResult = parseWorkerEnv(process.env);
if (!envResult.ok) {
	// Initialize Sentry from whatever DSN we can recover so the validation
	// failure isn't lost. process.env.SENTRY_DSN bypasses our own parser, but
	// if it's a syntactic mess Sentry's init will simply no-op.
	initSentry({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT,
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
	process.exit(EXIT_CONFIG_ERROR);
}

const { env } = envResult;

if (!env.RESEND_SYNC_WORKER_ENABLED) {
	// Logged before Sentry init: it's the explicit "disabled" path, not an
	// error worth capturing. Visible in stdout so devs notice the gate.
	logger.info(
		"resend-sync: worker disabled (RESEND_SYNC_WORKER_ENABLED != 'true'); exiting",
	);
	process.exit(0);
}

initSentry({
	dsn: env.SENTRY_DSN,
	enabled: env.SENTRY_ENABLED,
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

let topicId: string | null;
try {
	topicId = await findNewsletterTopicId({
		apiKey: env.RESEND_API_KEY,
		dispatcher,
	});
} catch (err) {
	// Network blip or Resend 5xx/429 at boot — transient. Exit 1 so Fly restarts
	// us; exit 78 here would mark the worker as permanently misconfigured.
	logger.error(
		{ err: { message: (err as Error).message, name: (err as Error).name } },
		"resend-sync: transient failure resolving Newsletter topic; exiting for restart",
	);
	Sentry.captureException(err, {
		fingerprint: ["resend-sync", "newsletter-topic-transient"],
	});
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}
if (!topicId) {
	// Either the topic genuinely doesn't exist, or the API key lacks scope —
	// both are real misconfigurations a restart won't fix.
	logger.fatal(
		{ apiUrl: env.INTERNAL_API_URL },
		'resend-sync: "Newsletter" topic not found or inaccessible (check RESEND_API_KEY scope); exiting',
	);
	Sentry.captureException(
		new Error('Resend "Newsletter" topic not found or inaccessible'),
		{
			fingerprint: ["resend-sync", "newsletter-topic-not-found"],
		},
	);
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(EXIT_CONFIG_ERROR);
}

const resend: ResendUpsert = createResendUpsert({
	apiKey: env.RESEND_API_KEY,
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

/** Awaitable sleep that resolves immediately on abort, so SIGTERM during a poll-sleep wakes the loop. */
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
		// eslint-disable-next-line no-await-in-loop -- intentional pace gate between cycles.
		await sleepWithAbort(env.RESEND_SYNC_POLL_MS, controller.signal);
	}
	logger.info("resend-sync: shutting down");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(0);
} catch (err) {
	Sentry.captureException(err);
	logger.error({ err }, "resend-sync: fatal error");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}
