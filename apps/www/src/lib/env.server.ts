import { z } from 'zod'

const baseSchema = z.object({
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.string(),
	DATABASE_AUTH_TOKEN: z.string().optional(),
	DATABASE_URL: z.string().min(1),
	EMAIL_FROM: z.string(),
	EMAIL_PROVIDER: z.string(),
	HMAC_SECRET: z.string().min(32),
	MIGRATE_ON_REQUEST: z.stringbool().default(false),
	NODE_ENV: z.string(),
})

const schema = z.preprocess(
	(raw) => ({
		NODE_ENV: 'development',
		EMAIL_PROVIDER: 'console',
		...(raw as object),
	}),
	z
		.discriminatedUnion('EMAIL_PROVIDER', [
			baseSchema.extend({
				EMAIL_PROVIDER: z.literal('resend'),
				RESEND_API_KEY: z.string().min(1),
			}),
			baseSchema.extend({
				EMAIL_PROVIDER: z.enum(['console', 'silent']),
			}),
		])
		.superRefine((data, ctx) => {
			// Sending real emails is required in production; the console stub must not be used.
			if (data.NODE_ENV === 'production' && data.EMAIL_PROVIDER !== 'resend') {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['EMAIL_PROVIDER'],
					message: 'Must be "resend" in production',
				})
			}
		})
)

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
