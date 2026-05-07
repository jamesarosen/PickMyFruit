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

const geocodingSchema = z.discriminatedUnion('PROVIDER', [
	z.object({ PROVIDER: z.literal('nominatim') }),
	z.object({ PROVIDER: z.literal('stub') }),
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
		GEOCODING_PROVIDER = 'nominatim',
		RESEND_API_KEY,
		STORAGE_PROVIDER = 'local',
		MEDIA_ORIGIN,
		...rest
	} = env
	return {
		...rest,
		email: { PROVIDER: EMAIL_PROVIDER, RESEND_API_KEY },
		geocoding: { PROVIDER: GEOCODING_PROVIDER },
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
		MIGRATE_ON_REQUEST: z.stringbool().prefault('false'),
		NODE_ENV: z.string().prefault('development'),
		SHARP_CONCURRENCY: z.coerce.number().int().positive().prefault(1),
		email: emailSchema,
		geocoding: geocodingSchema,
		storage: storageSchema,
	})
	.superRefine((env, ctx) => {
		// Stub geocoding must not be used in production.
		if (env.NODE_ENV === 'production' && env.geocoding.PROVIDER !== 'nominatim') {
			ctx.addIssue({
				code: 'custom',
				path: ['GEOCODING_PROVIDER'],
				message: 'Must be "nominatim" in production',
			})
		}

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
