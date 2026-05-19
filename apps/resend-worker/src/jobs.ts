import type { ResendEmailJobData } from "./jobs-schema.js";
import type { TokenBucket } from "./token-bucket.js";
import { Sentry } from "./sentry.js";
import { logger } from "./logger.js";

/**
 * Result returned by a queue handler. The poll loop turns this into either a
 * `/complete` or a `/fail` call.
 */
export type HandlerResult =
	| { kind: "ok" }
	| { kind: "retry"; error: string; retryInSeconds: number }
	| { kind: "fail"; error: string };

export interface ResendEmailHandlerDeps {
	bucket: TokenBucket;
	/** Future: real Resend email-send client. Slice 1 only needs the noop path. */
}

/**
 * Dispatch handler for the `resend-email` queue. The Zod-narrowed union lets
 * each branch pull only the fields it needs. Slice 1 ships the `noop` branch
 * so the loop can be exercised end-to-end; `inquiry-email` arrives in Slice 2
 * and `newsletter-opt-out` in Slice 3.
 */
export async function handleResendEmail(
	data: ResendEmailJobData,
	_deps: ResendEmailHandlerDeps,
): Promise<HandlerResult> {
	switch (data.type) {
		case "noop":
			return { kind: "ok" };
		case "inquiry-email":
			// Implemented in Slice 2; until then surface the wiring gap loudly.
			logger.warn(
				{ type: data.type },
				"resend-worker: inquiry-email handler not yet implemented",
			);
			Sentry.captureException(
				new Error("inquiry-email handler not yet implemented"),
				{ fingerprint: ["resend-worker", "inquiry-email", "unimplemented"] },
			);
			return { kind: "fail", error: "handler-unimplemented" };
		case "newsletter-opt-out":
			// Implemented in Slice 3.
			logger.warn(
				{ type: data.type },
				"resend-worker: newsletter-opt-out handler not yet implemented",
			);
			Sentry.captureException(
				new Error("newsletter-opt-out handler not yet implemented"),
				{
					fingerprint: ["resend-worker", "newsletter-opt-out", "unimplemented"],
				},
			);
			return { kind: "fail", error: "handler-unimplemented" };
	}
}
