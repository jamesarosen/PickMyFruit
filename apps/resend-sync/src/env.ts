import { z } from "zod";

const baseEnv = z.object({
	INTERNAL_API_URL: z.string().url(),
	INTERNAL_API_SECRET: z.string().min(32),
	RESEND_API_KEY: z.string().min(1),
	RESEND_AUDIENCE_ID: z.string().min(1),
	RESEND_SYNC_POLL_MS: z.coerce.number().int().positive().prefault(60_000),
	RESEND_API_RATE_PER_SEC: z.coerce.number().positive().prefault(4),
	RESEND_API_BUCKET_CAPACITY: z.coerce.number().int().positive().prefault(4),
	RESEND_SYNC_CURSOR_PATH: z
		.string()
		.min(1)
		.prefault("/app/data/resend-sync/cursor.json"),
	SENTRY_DSN: z.string().optional(),
	SENTRY_ENVIRONMENT: z.string().prefault("resend-sync"),
	SENTRY_RELEASE: z.string().optional(),
	NODE_ENV: z.string().prefault("production"),
});

export type WorkerEnv = z.infer<typeof baseEnv>;

/** Parses and validates the worker process environment. Throws on invalid input. */
export function parseWorkerEnv(raw: NodeJS.ProcessEnv): WorkerEnv {
	const result = baseEnv.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		throw new Error(
			`resend-sync env validation failed. Check Fly secrets or .env.development:\n${issues}`,
		);
	}
	return result.data;
}
