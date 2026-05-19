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

const mediaOriginSchema = z.preprocess(
	(val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
	z
		.string()
		.url()
		.transform((url) => url.replace(/\/+$/, ''))
		.optional()
)

const tigrisStorageSchema = z
	.object({
		AWS_ACCESS_KEY_ID: z.string().min(1),
		AWS_ENDPOINT_URL_S3: z.string().min(1),
		AWS_SECRET_ACCESS_KEY: z.string().min(1),
		BUCKET_NAME: z.string().min(1),
		PROVIDER: z.literal('tigris'),
		MEDIA_ORIGIN: mediaOriginSchema,
	})
	.transform(({ MEDIA_ORIGIN, ...rest }) => ({
		...rest,
		mediaOrigin:
			MEDIA_ORIGIN ?? `https://${rest.BUCKET_NAME}.fly.storage.tigris.dev`,
	}))

const storageSchema = z.discriminatedUnion('PROVIDER', [
	z.object({
		DATA_DIR: z.string().min(1),
		PROVIDER: z.literal('local'),
	}),
	tigrisStorageSchema,
])

/** Restructures flat env vars into namespaced sub-objects before schema validation. */
function preprocessEnv(raw: unknown): unknown {
	if (typeof raw !== 'object' || !raw) return raw
	const env = raw as Record<string, unknown>
	const {
		AWS_ENDPOINT_URL_S3,
		AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY,
		BUCKET_NAME,
		DATA_DIR,
		EMAIL_PROVIDER = 'console',
		RESEND_API_KEY,
		STORAGE_PROVIDER = 'local',
		MEDIA_ORIGIN,
		...rest
	} = env
	return {
		...rest,
		email: { PROVIDER: EMAIL_PROVIDER, RESEND_API_KEY },
		storage: {
			PROVIDER: STORAGE_PROVIDER,
			AWS_ACCESS_KEY_ID,
			AWS_SECRET_ACCESS_KEY,
			AWS_ENDPOINT_URL_S3,
			BUCKET_NAME,
			DATA_DIR,
			MEDIA_ORIGIN,
		},
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
		INTERNAL_API_SECRET: z.string().min(32).optional(),
		INTERNAL_API_SECRET_PREVIOUS: z.string().min(32).optional(),
		MIGRATE_ON_REQUEST: z.stringbool().prefault('false'),
		NODE_ENV: z.string().prefault('development'),
		SHARP_CONCURRENCY: z.coerce.number().int().positive().prefault(1),
		email: emailSchema,
		storage: storageSchema,
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

		// Local file is insufficiently robust for storage in production.
		if (env.NODE_ENV === 'production' && env.storage.PROVIDER !== 'tigris') {
			ctx.addIssue({
				code: 'custom',
				path: ['STORAGE_PROVIDER'],
				message: 'Must be "tigris" in production',
			})
		}

		// The internal API is the only consumer of INTERNAL_API_SECRET. Require it
		// in production so the resend-sync worker can't silently fall back to 404.
		if (env.NODE_ENV === 'production' && !env.INTERNAL_API_SECRET) {
			ctx.addIssue({
				code: 'custom',
				path: ['INTERNAL_API_SECRET'],
				message: 'Required in production for the internal API perimeter',
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

const parsedEnv = result.data

/**
 * Validated server-side environment variables.
 *
 * Properties use their canonical SCREAMING_SNAKE_CASE names so they match
 * what operators set in .env files, Docker, and Fly secrets.
 * When `storage.PROVIDER` is `tigris`, `storage.mediaOrigin` is the public photo
 * origin (`MEDIA_ORIGIN` or the default bucket CDN host).
 */
export const serverEnv = parsedEnv
