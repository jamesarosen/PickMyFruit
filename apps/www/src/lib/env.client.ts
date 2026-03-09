import { z } from 'zod'

const isProd = import.meta.env.PROD as boolean

/**
 * @see Dockerfile
 * @see fly.toml [build.args]
 */
const schema = z
	.object({
		VITE_SENTRY_DSN: z.url().optional(),
		VITE_SENTRY_ENABLED: z
			.enum(['true', 'false'])
			.transform((v) => v === 'true')
			.optional(),
		VITE_SENTRY_ERROR_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
		VITE_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
	})
	.transform((data) => ({
		sentryDsn: data.VITE_SENTRY_DSN,
		// In prod: default to true if DSN is available
		// In other envs: default to false (reporting off, opt-in for testing)
		sentryEnabled:
			data.VITE_SENTRY_ENABLED ?? (isProd && Boolean(data.VITE_SENTRY_DSN)),
		// In prod: default to 1.0 (100%); in other envs default to 0 (off)
		sentrySampleRate: data.VITE_SENTRY_ERROR_SAMPLE_RATE ?? (isProd ? 1.0 : 0),
		sentryTracesSampleRate:
			data.VITE_SENTRY_TRACES_SAMPLE_RATE ?? (isProd ? 1.0 : 0),
		mode: import.meta.env.MODE as string,
		prod: isProd,
	}))
	.refine((data) => !isProd || data.sentryDsn, {
		message: 'VITE_SENTRY_DSN must be set in production',
	})

const result = schema.safeParse({
	VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
	VITE_SENTRY_ENABLED: import.meta.env.VITE_SENTRY_ENABLED,
	VITE_SENTRY_ERROR_SAMPLE_RATE: import.meta.env.VITE_SENTRY_ERROR_SAMPLE_RATE,
	VITE_SENTRY_TRACES_SAMPLE_RATE: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
})
if (!result.success) {
	const issues = result.error.issues.map(
		(i) => `  ${i.path.join('.')}: ${i.message}`
	)
	throw new Error(
		`Client environment validation failed. Check fly.toml [build.args], .env, and Dockerfile ARGs:\n${issues.join('\n')}`
	)
}

/**
 * Validated client-side environment variables.
 *
 * Properties use camelCase with the VITE_ prefix stripped since that prefix
 * is a build-tool detail. Compare with serverEnv, which keeps canonical
 * SCREAMING_SNAKE_CASE names matching what operators set in .env / Docker.
 */
export const clientEnv = result.data
