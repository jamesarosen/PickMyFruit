/**
 * Entry point for the resend-sync worker.
 *
 * Runs as a Fly scheduled machine (`fly machine run . --schedule hourly`),
 * sharing the volume at /app/data with the `app` process group. Each invocation
 * drains the user queue once and exits 0. SIGTERM/SIGINT finish the in-flight
 * row, write the cursor, and exit 0.
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

logger.info(
	{
		cursorPath: env.RESEND_SYNC_CURSOR_PATH,
		ratePerSec: env.RESEND_API_RATE_PER_SEC,
		internalApiUrl: env.INTERNAL_API_URL,
	},
	"resend-sync: starting",
);

try {
	await runCycle({
		internal,
		resend,
		bucket,
		cursorPath: env.RESEND_SYNC_CURSOR_PATH,
		signal: controller.signal,
	});
	logger.info("resend-sync: drained, exiting");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(0);
} catch (err) {
	Sentry.captureException(err);
	logger.error({ err }, "resend-sync: fatal error");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}
