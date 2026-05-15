import { z } from 'zod'

const resendSyncProviderSchema = z.discriminatedUnion('RESEND_SYNC_PROVIDER', [
	z.object({
		RESEND_SYNC_PROVIDER: z.literal('resend'),
		RESEND_API_KEY: z.string().min(1),
		RESEND_AUDIENCE_ID: z.string().min(1),
	}),
	z.object({
		RESEND_SYNC_PROVIDER: z.enum(['disabled']),
	}),
])

const workerEnvSchema = z
	.object({
		DATABASE_URL: z.string().min(1),
		NODE_ENV: z.string().prefault('production'),
		RESEND_SYNC_POLL_MS: z.coerce.number().int().positive().prefault(60_000),
		RESEND_SYNC_PROVIDER: z.string().prefault('disabled'),
		RESEND_API_KEY: z.string().optional(),
		RESEND_AUDIENCE_ID: z.string().optional(),
	})
	.transform((env) => ({
		DATABASE_URL: env.DATABASE_URL,
		NODE_ENV: env.NODE_ENV,
		RESEND_SYNC_POLL_MS: env.RESEND_SYNC_POLL_MS,
		sync: resendSyncProviderSchema.parse(env),
	}))

export type WorkerEnv = z.infer<typeof workerEnvSchema>

/** Parses and validates the worker process environment. Throws on invalid input. */
export function parseWorkerEnv(raw: NodeJS.ProcessEnv): WorkerEnv {
	return workerEnvSchema.parse(raw)
}
