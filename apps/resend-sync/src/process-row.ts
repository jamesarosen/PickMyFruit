import type { InternalApiClient } from "./internal-api-client.js";
import type { ResendUpsert } from "./resend-client.js";
import type { TokenBucket } from "./token-bucket.js";
import { logger } from "./logger.js";
import { Sentry } from "./sentry.js";
import { readCursorFile, writeCursorFile } from "./cursor-file.js";

/** Return value of processOneRow, indicating what runCycle should do next. */
export type ProcessOneRowResult =
	| "processed" // row upserted (or 4xx-skipped); cursor advanced; keep cycling
	| "drained" // no rows past cursor; cycle is done
	| "stalled"; // 5xx/network; cursor not advanced; stop this cycle and retry next tick

export interface ProcessOneRowDeps {
	internal: InternalApiClient;
	resend: ResendUpsert;
	bucket: TokenBucket;
	cursorPath: string;
}

/**
 * One iteration of the sync cycle:
 * 1. Read the cursor file.
 * 2. Ask the internal API for the next user past that cursor.
 * 3. If drained, persist the echoed cursor and return 'drained'.
 * 4. Otherwise: spend 2 tokens, call Resend, and either advance the cursor
 *    (success or permanent 4xx) or stall (5xx/network/429).
 */
export async function processOneRow(
	deps: ProcessOneRowDeps,
): Promise<ProcessOneRowResult> {
	const state = await readCursorFile(deps.cursorPath);

	const apiResult = await deps.internal(state.cursor);

	if (apiResult.kind === "network-error" || apiResult.kind === "server-error") {
		const status = apiResult.kind === "server-error" ? apiResult.status : 0;
		const err =
			apiResult.kind === "network-error"
				? apiResult.error
				: new Error(`internal API ${apiResult.status}: ${apiResult.message}`);
		logger.warn(
			{
				err: { message: err.message, name: err.name },
				status,
				retryAfterMs:
					apiResult.kind === "server-error" ? apiResult.retryAfterMs : null,
			},
			"resend-sync: stalled — internal API unavailable",
		);
		Sentry.captureException(err, {
			fingerprint: ["resend-sync", "upstream-unavailable"],
			extra: { source: "www", status },
		});
		if (apiResult.kind === "server-error" && apiResult.retryAfterMs) {
			await deps.bucket.honorRetryAfter(apiResult.retryAfterMs);
		}
		return "stalled";
	}

	if (apiResult.kind === "client-error") {
		// A 4xx from our own internal API is a programming error, not a poisoned row.
		// Most common cause in dev: INTERNAL_API_SECRET mismatch → www returns 404.
		// Treat as a stall — humans need to fix the contract or the secret.
		logger.warn(
			{ status: apiResult.status, message: apiResult.message },
			"resend-sync: stalled — internal API rejected the request (check INTERNAL_API_SECRET)",
		);
		Sentry.captureException(
			new Error(`internal API ${apiResult.status}: ${apiResult.message}`),
			{
				fingerprint: ["resend-sync", "upstream-unavailable"],
				extra: { source: "www", status: apiResult.status },
			},
		);
		return "stalled";
	}

	const body = apiResult.body;

	if (body.user === null) {
		// Drained: persist the echoed cursor (no-op if unchanged) and stop.
		if (body.nextCursor !== state.cursor) {
			await writeCursorFile(deps.cursorPath, body.nextCursor);
		}
		return "drained";
	}

	const user = body.user;

	// Each upsert costs 2 Resend API calls (GET → POST|PATCH). Sized in calls
	// so the math survives if Resend ever ships a single-call upsert.
	await deps.bucket.take(2);

	const upsertResult = await deps.resend({
		id: user.id,
		email: user.email,
		name: user.name,
		phone: user.phone,
	});

	if (upsertResult.kind === "ok") {
		await writeCursorFile(deps.cursorPath, body.nextCursor);
		logger.info(
			{ userId: user.id, cursor: body.nextCursor },
			"resend-sync: upserted",
		);
		return "processed";
	}

	if (upsertResult.kind === "client-error") {
		// 4xx is permanent for this row — advance past it so we never retry.
		// Logged at warn so dev (where Sentry is typically off) still sees it.
		await writeCursorFile(deps.cursorPath, body.nextCursor);
		logger.warn(
			{
				userId: user.id,
				status: upsertResult.status,
				message: upsertResult.message,
			},
			"resend-sync: Resend 4xx — row skipped (check RESEND_API_KEY / contact data)",
		);
		Sentry.captureException(
			new Error(`Resend 4xx for ${user.id}: ${upsertResult.message}`),
			{
				fingerprint: ["resend-sync", "resend-4xx"],
				extra: { userId: user.id, status: upsertResult.status },
			},
		);
		return "processed";
	}

	// 5xx/429/network — stall. Next tick retries the same row.
	if (
		upsertResult.kind === "server-error" &&
		upsertResult.retryAfterMs !== null
	) {
		await deps.bucket.honorRetryAfter(upsertResult.retryAfterMs);
	}
	const err =
		upsertResult.kind === "network-error"
			? upsertResult.error
			: new Error(
					`Resend ${upsertResult.status} for ${user.id}: ${upsertResult.message}`,
				);
	logger.warn(
		{
			userId: user.id,
			err: { message: err.message, name: err.name },
			status: upsertResult.kind === "server-error" ? upsertResult.status : null,
			retryAfterMs:
				upsertResult.kind === "server-error" ? upsertResult.retryAfterMs : null,
		},
		"resend-sync: stalled — Resend unavailable",
	);
	Sentry.captureException(err, {
		fingerprint: ["resend-sync", "resend-unavailable"],
		extra: {
			userId: user.id,
			status: upsertResult.kind === "server-error" ? upsertResult.status : null,
			retryAfter:
				upsertResult.kind === "server-error" ? upsertResult.retryAfterMs : null,
		},
	});
	return "stalled";
}
