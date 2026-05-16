import { z } from "zod";

/**
 * `RESEND_SYNC_PROVIDER` is a capability flag. In `disabled` mode the worker
 * runs end-to-end (cursor advances, logs fire, signals work) without calling
 * Resend, so local dev doesn't need a real API key. Production must use
 * `resend`, enforced by the discriminator below.
 */
const providerSchema = z.discriminatedUnion("RESEND_SYNC_PROVIDER", [
	z.object({
		RESEND_SYNC_PROVIDER: z.literal("resend"),
		RESEND_API_KEY: z.string().min(1),
		RESEND_AUDIENCE_ID: z.string().min(1),
	}),
	z.object({
		RESEND_SYNC_PROVIDER: z.literal("disabled"),
	}),
]);

const baseEnv = z
	.object({
		INTERNAL_API_URL: z.string().url(),
		INTERNAL_API_SECRET: z.string().min(32),
		RESEND_SYNC_POLL_MS: z.coerce.number().int().positive().prefault(60_000),
		RESEND_API_RATE_PER_SEC: z.coerce.number().positive().prefault(4),
		RESEND_API_BUCKET_CAPACITY: z.coerce.number().int().positive().prefault(4),
		RESEND_SYNC_CURSOR_PATH: z
			.string()
			.min(1)
			.prefault("/app/data/resend-sync/cursor.json"),
		RESEND_SYNC_PROVIDER: z.string().prefault("disabled"),
		RESEND_API_KEY: z.string().optional(),
		RESEND_AUDIENCE_ID: z.string().optional(),
		SENTRY_DSN: z.string().optional(),
		SENTRY_ENVIRONMENT: z.string().prefault("resend-sync"),
		SENTRY_RELEASE: z.string().optional(),
		NODE_ENV: z.string().prefault("production"),
	})
	.superRefine((env, ctx) => {
		const provider = providerSchema.safeParse({
			RESEND_SYNC_PROVIDER: env.RESEND_SYNC_PROVIDER,
			RESEND_API_KEY: env.RESEND_API_KEY,
			RESEND_AUDIENCE_ID: env.RESEND_AUDIENCE_ID,
		});
		if (!provider.success) {
			for (const issue of provider.error.issues) {
				ctx.addIssue({
					code: "custom",
					path: issue.path,
					message: issue.message,
				});
			}
			return;
		}
		// Production must talk to a real Resend. `disabled` skips the API call;
		// `resend` is the only safe shipping mode.
		if (
			env.NODE_ENV === "production" &&
			provider.data.RESEND_SYNC_PROVIDER !== "resend"
		) {
			ctx.addIssue({
				code: "custom",
				path: ["RESEND_SYNC_PROVIDER"],
				message: "Must be 'resend' in production",
			});
		}
	})
	.transform((env) => {
		const provider = providerSchema.parse({
			RESEND_SYNC_PROVIDER: env.RESEND_SYNC_PROVIDER,
			RESEND_API_KEY: env.RESEND_API_KEY,
			RESEND_AUDIENCE_ID: env.RESEND_AUDIENCE_ID,
		});
		return {
			INTERNAL_API_URL: env.INTERNAL_API_URL,
			INTERNAL_API_SECRET: env.INTERNAL_API_SECRET,
			RESEND_SYNC_POLL_MS: env.RESEND_SYNC_POLL_MS,
			RESEND_API_RATE_PER_SEC: env.RESEND_API_RATE_PER_SEC,
			RESEND_API_BUCKET_CAPACITY: env.RESEND_API_BUCKET_CAPACITY,
			RESEND_SYNC_CURSOR_PATH: env.RESEND_SYNC_CURSOR_PATH,
			SENTRY_DSN: env.SENTRY_DSN,
			SENTRY_ENVIRONMENT: env.SENTRY_ENVIRONMENT,
			SENTRY_RELEASE: env.SENTRY_RELEASE,
			NODE_ENV: env.NODE_ENV,
			provider,
		};
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
export function parseWorkerEnv(raw: NodeJS.ProcessEnv): ParseWorkerEnvResult {
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
