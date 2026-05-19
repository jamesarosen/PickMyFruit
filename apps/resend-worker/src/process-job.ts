import type { JobsApiClient } from "./jobs-api-client.js";
import type { TokenBucket } from "./token-bucket.js";
import { queueSchemas, type Queue } from "./jobs-schema.js";
import { handleResendEmail } from "./jobs.js";
import { Sentry } from "./sentry.js";
import { logger } from "./logger.js";

export type ProcessJobResult = "processed" | "drained" | "stalled";

export interface ProcessJobDeps {
	jobs: JobsApiClient;
	bucket: TokenBucket;
	workerId: string;
	leaseSeconds: number;
	queue: Queue;
}

/**
 * Drives one iteration of the jobs loop:
 * 1. POST /claim — get the next ready row (server-side reaper unclaims expired leases).
 * 2. Zod-validate `data` against the queue's payload schema. A mismatch fails
 *    the row permanently with `schema-mismatch`; the worker keeps cycling.
 * 3. Dispatch to the per-queue handler.
 * 4. POST /complete on `ok`, POST /fail (with optional retry) otherwise.
 */
export async function processOneJob(
	deps: ProcessJobDeps,
): Promise<ProcessJobResult> {
	const claimResult = await deps.jobs.claim({
		queue: deps.queue,
		workerId: deps.workerId,
		leaseSeconds: deps.leaseSeconds,
	});

	if (
		claimResult.kind === "server-error" ||
		claimResult.kind === "network-error" ||
		claimResult.kind === "client-error"
	) {
		const status =
			claimResult.kind === "server-error" || claimResult.kind === "client-error"
				? claimResult.status
				: 0;
		const err =
			claimResult.kind === "network-error"
				? claimResult.error
				: new Error(`jobs/claim ${claimResult.status}: ${claimResult.message}`);
		logger.warn(
			{
				err: { message: err.message, name: err.name },
				status,
			},
			"resend-worker: stalled — jobs claim failed",
		);
		Sentry.captureException(err, {
			fingerprint: ["resend-worker", "claim-unavailable"],
			extra: { queue: deps.queue, status },
		});
		if (claimResult.kind === "server-error" && claimResult.retryAfterMs)
			await deps.bucket.honorRetryAfter(claimResult.retryAfterMs);
		return "stalled";
	}

	const { job } = claimResult.body;
	if (job === null) return "drained";

	const schema = queueSchemas[deps.queue];

	let parsedData: unknown;
	try {
		parsedData = JSON.parse(job.data);
	} catch (err) {
		await failPermanent(deps, job.id, "schema-mismatch");
		Sentry.captureException(err as Error, {
			fingerprint: ["resend-worker", deps.queue, "schema-mismatch"],
			extra: { jobId: job.id },
		});
		return "processed";
	}

	const validated = schema.safeParse(parsedData);
	if (!validated.success) {
		await failPermanent(deps, job.id, "schema-mismatch");
		Sentry.captureException(
			new Error(
				`jobs payload schema mismatch on ${deps.queue}: ${validated.error.message}`,
			),
			{
				fingerprint: ["resend-worker", deps.queue, "schema-mismatch"],
				extra: { jobId: job.id },
			},
		);
		return "processed";
	}

	// Dispatch. Currently the only registered queue is `resend-email`.
	const handlerResult = await handleResendEmail(validated.data, {
		bucket: deps.bucket,
	});

	if (handlerResult.kind === "ok") {
		const completeResult = await deps.jobs.complete({
			id: job.id,
			workerId: deps.workerId,
		});
		if (completeResult.kind !== "ok") {
			// Network or 5xx on complete — the lease will expire and another
			// worker will pick it up. Idempotency (Resend's idempotency-key header
			// in Slice 2+) handles the re-attempt.
			logger.warn(
				{ jobId: job.id },
				"resend-worker: complete call failed; lease will expire",
			);
			Sentry.captureException(new Error(`jobs/complete failed for ${job.id}`), {
				fingerprint: ["resend-worker", "complete-unavailable"],
			});
		}
		return "processed";
	}

	if (handlerResult.kind === "retry") {
		await deps.jobs.fail({
			id: job.id,
			workerId: deps.workerId,
			error: handlerResult.error,
			retryInSeconds: handlerResult.retryInSeconds,
		});
		return "processed";
	}

	await failPermanent(deps, job.id, handlerResult.error);
	return "processed";
}

async function failPermanent(
	deps: ProcessJobDeps,
	id: string,
	error: string,
): Promise<void> {
	const result = await deps.jobs.fail({
		id,
		workerId: deps.workerId,
		error,
	});
	if (result.kind !== "ok") {
		logger.warn(
			{ jobId: id, error },
			"resend-worker: fail call failed; lease will expire and re-claim",
		);
	}
}
