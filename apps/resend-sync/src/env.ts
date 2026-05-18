import { z } from "zod";

const baseEnv = z.object({
	INTERNAL_API_URL: z.url(),
	INTERNAL_API_SECRET: z.string().min(32),
	RESEND_SYNC_POLL_MS: z.coerce.number().int().positive().prefault(60_000),
	RESEND_SYNC_WORKER_ENABLED: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.prefault("false"),
	RESEND_API_RATE_PER_SEC: z.coerce.number().positive().prefault(4),
	RESEND_API_BUCKET_CAPACITY: z.coerce.number().int().positive().prefault(4),
	RESEND_SYNC_CURSOR_PATH: z
		.string()
		.min(1)
		.prefault("/app/data/resend-sync/cursor.json"),
	RESEND_API_KEY: z.string(),
	SENTRY_DSN: z.url().optional(),
	SENTRY_ENABLED: z
		.enum(["true", "false"])
		.transform((v) => v === "true")
		.optional(),
	SENTRY_ENVIRONMENT: z.string().optional(),
	SENTRY_RELEASE: z.string().optional(),
	NODE_ENV: z.string().prefault("development"),
});

export type WorkerEnv = z.infer<typeof baseEnv>;

export type EnvValidationError = {
	readonly kind: "env-validation-failed";
	readonly message: string;
	readonly issues: ReadonlyArray<{ path: string; message: string }>;
};

export type ParseWorkerEnvResult =
	| { ok: true; env: WorkerEnv }
	| { ok: false; error: EnvValidationError };

/**
 * Parses and validates the worker environment. Returns a discriminated result
 * instead of throwing so `main.ts` can log + Sentry-capture the failure with
 * full structured data before exiting.
 */
export function parseWorkerEnv(
	raw: Record<string, string | undefined>,
): ParseWorkerEnvResult {
	const result = baseEnv.safeParse(raw);
	if (result.success) return { ok: true, env: result.data };

	const issues = result.error.issues.map((i) => ({
		path: i.path.map(String).join("."),
		message: i.message,
	}));
	const summary = issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
	return {
		ok: false,
		error: {
			kind: "env-validation-failed",
			message: `resend-sync env validation failed. Check Fly secrets or .env.development:\n${summary}`,
			issues,
		},
	};
}
