import { z } from 'zod'

let fileEnv: Record<string, string> = {}
if (process.env.NODE_ENV !== 'production') {
	try {
		const { loadEnv } = await import('vite')
		try {
			fileEnv = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '')
		} catch (err) {
			console.warn(
				'env.server: loadEnv failed, falling back to process.env only',
				err
			)
		}
	} catch {
		// vite not installed — production runtime or standalone script, expected
	}
}

const schema = z.object({
	NODE_ENV: z.string().default('development'),
	DATABASE_URL: z.string().min(1),
	DATABASE_AUTH_TOKEN: z.string().optional(),
	BETTER_AUTH_SECRET: z.string().min(32),
	BETTER_AUTH_URL: z.string().optional(),
	RESEND_API_KEY: z.string().optional(),
	EMAIL_FROM: z.string().optional(),
	LOG_DEV_EMAILS: z.string().transform((v) => v === 'true'),
	HMAC_SECRET: z.string().min(32),
})

const result = schema.safeParse({ ...fileEnv, ...process.env })
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
