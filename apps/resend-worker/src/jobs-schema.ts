import { z } from "zod";

/**
 * Payload schemas for the `resend-email` queue.
 *
 * **Duplicated in `apps/www/src/data/jobs.server.ts`.** Keep both copies in
 * sync — they form the contract between the producer (apps/www) and the
 * worker. A row whose JSON fails this schema gets marked failed with
 * `schema-mismatch` instead of crashing the worker.
 */
export const ResendEmailJob = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("inquiry-email"),
		from: z.string().min(1),
		to: z.string().email(),
		replyTo: z.string().email().optional(),
		subject: z.string().min(1),
		html: z.string().min(1),
	}),
	z.object({
		type: z.literal("newsletter-opt-out"),
		email: z.string().email(),
	}),
	z.object({ type: z.literal("noop") }),
]);

export type ResendEmailJobData = z.infer<typeof ResendEmailJob>;

export const queueSchemas = {
	"resend-email": ResendEmailJob,
} as const;

export type Queue = keyof typeof queueSchemas;

/**
 * Wire shape of `POST /internal/v1/jobs/claim` responses. `job.data` is the
 * raw JSON string the producer stored; the worker decodes + Zod-validates it.
 */
export const claimResponseSchema = z.object({
	job: z
		.object({
			id: z.string(),
			queue: z.string(),
			data: z.string(),
			attempts: z.number().int().nonnegative(),
		})
		.nullable(),
});

export type ClaimResponse = z.infer<typeof claimResponseSchema>;
