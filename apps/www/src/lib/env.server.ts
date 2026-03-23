import { z } from 'zod'

const emailSchema = z.discriminatedUnion('PROVIDER', [
	z.object({
		PROVIDER: z.literal('resend'),
		RESEND_API_KEY: z.string().min(1),
	}),
	z.object({
		PROVIDER: z.enum(['console', 'silent']),
	}),
])

/** Restructures flat env vars into namespaced sub-objects before schema validation. */
function preprocessEnv(raw: unknown): unknown {
	if (typeof raw !== 'object' || !raw) return raw
	const env = raw as Record<string, unknown>
	const { EMAIL_PROVIDER = 'console', RESEND_API_KEY, ...rest } = env
	return {
		...rest,
		email: { PROVIDER: EMAIL_PROVIDER, RESEND_API_KEY },
	}
}

const outputSchema = z
	.object({
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.string(),
		DATABASE_AUTH_TOKEN: z.string().optional(),
		DATABASE_URL: z.string().min(1),
		EMAIL_FROM: z
			.string()
			.regex(/^.+\s<[^@]+@[^>]+>$/, 'Must be in "Display Name <email>" format'),
		HMAC_SECRET: z.string().min(32),
		MIGRATE_ON_REQUEST: z.stringbool().prefault('false'),
		NODE_ENV: z.string().prefault('development'),
		email: emailSchema,
	})
	.superRefine((env, ctx) => {
		// Sending real emails is required in production; the console stub must not be used.
		if (env.NODE_ENV === 'production' && env.email.PROVIDER !== 'resend') {
			ctx.addIssue({
				code: 'custom',
				path: ['EMAIL_PROVIDER'],
				message: 'Must be "resend" in production',
			})
		}
	})

export const schema = z.preprocess(preprocessEnv, outputSchema)

const result = schema.safeParse(process.env)
if (!result.success) {
	const missing = result.error.issues.map(
		(i) => `  ${i.path.join('.')}: ${i.message}`
	)
	throw new Error(
		`Environment validation failed. Check .env files or deployment secrets:\n${missing.join('\n')}`
	)
}

/**
 * Validated server-side environment variables.
 *
 * Properties use their canonical SCREAMING_SNAKE_CASE names so they match
 * what operators set in .env files, Docker, and Fly secrets.
 * Compare with clientEnv, which strips the VITE_ prefix into camelCase
 * since that prefix is a build-tool detail.
 */
export const serverEnv = result.data
