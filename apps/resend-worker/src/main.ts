/**
 * Entry point for the resend-worker.
 *
 * Long-lived process. In production, spawned as a child of `apps/www` (see
 * `apps/www/src/lib/spawn-resend-worker.server.ts`) on the same Fly machine,
 * sharing the volume at /app/data.
 *
 * Two cooperative loops share one token bucket so Resend's 5/sec ceiling is
 * enforced globally:
 * 1. user-sync — walks the `user.updated_at` cursor (issue #237).
 * 2. resend-email — claims rows from the generic outbox (issue #260).
 *
 * SIGTERM/SIGINT finishes the in-flight row in each loop, writes the cursor,
 * and exits 0. Gated by `RESEND_SYNC_WORKER_ENABLED` (default false).
 */
import { randomUUID } from "node:crypto";
import { Agent } from "undici";
import { parseWorkerEnv } from "./env.js";
import { initSentry, Sentry } from "./sentry.js";
import { logger } from "./logger.js";
import { createInternalApiClient } from "./internal-api-client.js";
import { createJobsApiClient } from "./jobs-api-client.js";
import { createResendUpsert, type ResendUpsert } from "./resend-client.js";
import { runCycle as runUserSyncCycle } from "./run-cycle.js";
import { runCycle as runScaffold } from "./cycle.js";
import { processOneJob } from "./process-job.js";
import { createTokenBucket } from "./token-bucket.js";

/** EX_CONFIG (sysexits.h 78): configuration error — distinct from shell 1/2. */
const EXIT_CONFIG_ERROR = 78;

const envResult = parseWorkerEnv(process.env);
if (!envResult.ok) {
	initSentry({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.SENTRY_ENVIRONMENT,
		release: process.env.SENTRY_RELEASE,
	});
	logger.fatal(
		{ issues: envResult.error.issues },
		"resend-worker: env validation failed; exiting",
	);
	Sentry.captureException(new Error(envResult.error.message), {
		fingerprint: ["resend-worker", "env-validation-failed"],
		extra: { issues: envResult.error.issues },
	});
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(EXIT_CONFIG_ERROR);
}

const { env } = envResult;

if (!env.RESEND_SYNC_WORKER_ENABLED) {
	logger.info(
		"resend-worker: disabled (RESEND_SYNC_WORKER_ENABLED != 'true'); exiting",
	);
	process.exit(0);
}

initSentry({
	dsn: env.SENTRY_DSN,
	enabled: env.SENTRY_ENABLED,
	environment: env.SENTRY_ENVIRONMENT,
	release: env.SENTRY_RELEASE,
});

const dispatcher = new Agent({
	keepAliveTimeout: 30_000,
	keepAliveMaxTimeout: 300_000,
});

const internal = createInternalApiClient({
	baseUrl: env.INTERNAL_API_URL,
	secret: env.INTERNAL_API_SECRET,
	dispatcher,
});

const jobsApi = createJobsApiClient({
	baseUrl: env.INTERNAL_API_URL,
	secret: env.INTERNAL_API_SECRET,
	dispatcher,
});

const resend: ResendUpsert = createResendUpsert({
	apiKey: env.RESEND_API_KEY,
	dispatcher,
});

// One token bucket shared across both loops — the user-sync upserts and the
// email-jobs sends are all Resend API calls, and Resend rate-limits per
// account, not per endpoint.
const bucket = createTokenBucket({
	ratePerSec: env.RESEND_API_RATE_PER_SEC,
	capacity: env.RESEND_API_BUCKET_CAPACITY,
});

const workerId = `resend-worker-${randomUUID()}`;

const controller = new AbortController();

function shutdown(signal: string): void {
	logger.info({ signal }, "resend-worker: shutdown signal received");
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
		internalApiUrl: env.INTERNAL_API_URL,
		workerId,
	},
	"resend-worker: starting",
);

async function userSyncLoop(): Promise<void> {
	while (!controller.signal.aborted) {
		// eslint-disable-next-line no-await-in-loop -- each cycle must commit before sleeping.
		await runUserSyncCycle({
			internal,
			resend,
			bucket,
			cursorPath: env.RESEND_SYNC_CURSOR_PATH,
			signal: controller.signal,
		});
		if (controller.signal.aborted) break;
		// eslint-disable-next-line no-await-in-loop -- intentional pace gate.
		await sleepWithAbort(env.RESEND_SYNC_POLL_MS, controller.signal);
	}
}

async function jobsLoop(): Promise<void> {
	while (!controller.signal.aborted) {
		// eslint-disable-next-line no-await-in-loop -- each cycle must commit before sleeping.
		await runScaffold({
			name: "resend-email",
			step: () =>
				processOneJob({
					jobs: jobsApi,
					bucket,
					workerId,
					leaseSeconds: env.RESEND_WORKER_JOB_LEASE_SECONDS,
					queue: "resend-email",
				}),
			signal: controller.signal,
		});
		if (controller.signal.aborted) break;
		// eslint-disable-next-line no-await-in-loop -- intentional pace gate.
		await sleepWithAbort(env.RESEND_SYNC_POLL_MS, controller.signal);
	}
}

try {
	await Promise.all([userSyncLoop(), jobsLoop()]);
	logger.info("resend-worker: shutting down");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(0);
} catch (err) {
	Sentry.captureException(err);
	logger.error({ err }, "resend-worker: fatal error");
	await Sentry.close(2_000).catch(() => undefined);
	process.exit(1);
}
