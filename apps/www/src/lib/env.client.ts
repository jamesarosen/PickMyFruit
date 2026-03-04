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
	})
	.transform((data) => ({
		sentryDsn: data.VITE_SENTRY_DSN,
		// In prod: default to true if DSN is available
		// In other envs: default to false (reporting off, opt-in for testing)
		sentryEnabled:
			data.VITE_SENTRY_ENABLED ?? (isProd && Boolean(data.VITE_SENTRY_DSN)),
		mode: import.meta.env.MODE as string,
		prod: isProd,
	}))
	.refine((data) => !isProd || data.sentryDsn, {
		message: 'VITE_SENTRY_DSN must be set in production',
	})

const result = schema.safeParse({
	VITE_SENTRY_DSN: import.meta.env.VITE_SENTRY_DSN,
	VITE_SENTRY_ENABLED: import.meta.env.VITE_SENTRY_ENABLED,
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
