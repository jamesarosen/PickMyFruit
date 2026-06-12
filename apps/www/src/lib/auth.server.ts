import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start/solid'
import { db } from '../data/db.server'
import { serverEnv } from './env.server'
import { logger } from './logger.server'
import { escapeHtml } from './html-escape.server'
import { profileNameSchema } from './validation'
import { Sentry } from './sentry'
import { createSlidingWindowLimiter } from './rate-limit.server'

/**
 * Per-address cap on magic-link emails. IP throttling alone cannot stop a
 * distributed attacker from flooding one inbox and draining the Resend
 * quota. Enforced only on the resend path so local and E2E sign-ins (which
 * use the console/silent providers) stay unthrottled.
 */
const magicLinkEmailLimiter = createSlidingWindowLimiter({
	windowMs: 15 * 60 * 1000,
	max: 5,
})

const sendMagicLinkEmail = async ({
	email,
	url,
	token,
}: {
	email: string
	url: string
	token: string
}) => {
	if (serverEnv.email.PROVIDER === 'silent') return

	if (serverEnv.email.PROVIDER === 'console') {
		logger.info({ email, token, url }, 'Magic link (EMAIL_PROVIDER=console)')
		return
	}

	if (serverEnv.email.PROVIDER === 'resend') {
		if (!magicLinkEmailLimiter.attempt(email.toLowerCase())) {
			logger.warn({ email }, 'Magic link send throttled for address')
			throw new APIError('TOO_MANY_REQUESTS', {
				message:
					'Too many sign-in links have been requested for this address. Please try again later.',
			})
		}

		const { Resend } = await import('resend')
		const resend = new Resend(serverEnv.email.RESEND_API_KEY)

		const safeUrl = escapeHtml(url)
		const safeToken = escapeHtml(token)

		const { error } = await resend.emails.send({
			from: serverEnv.EMAIL_FROM,
			to: email,
			subject: 'Sign in to Pick My Fruit',
			html: `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
	<h1 style="color: #2d5016; margin-bottom: 24px;">Welcome to Pick My Fruit!</h1>
	<p>Click the button below to sign in:</p>
	<a href="${safeUrl}" style="display: inline-block; padding: 14px 28px; background: #4a7c23; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0;">Sign In</a>
	<p style="margin-top: 28px;">If the button does not work, go to the sign-in page on Pick My Fruit and paste the token below into the &ldquo;Or enter the token&rdquo; field.</p>
	<p style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 1.35rem; text-align: center; margin: 12px 0 0 0; letter-spacing: 0.02em;">${safeToken}</p>
	<p style="color: #666; font-size: 14px; margin-top: 24px;">This link expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
</body>
</html>
			`.trim(),
		})

		if (error) {
			throw new Error('Magic link email failed', { cause: error })
		}
	}
}

/**
 * Enqueue a durable workflow that syncs this user's profile to Resend. Used
 * by Better Auth's `user.create.after` and `user.update.after` hooks. Fires
 * and forgets — failures must not block the auth flow.
 */
function enqueueResendSync(user: {
	id: string
	email: string
	name: string
	updatedAt: Date | number | string | null | undefined
}): void {
	void (async () => {
		try {
			const { getRuntime } = await import('@/lib/kokoto.server')
			const { syncUserToResendWorkflow, syncUserIdempotencyKey } =
				await import('@/workflows/sync-user-to-resend.workflow.server')
			const updatedAtMs =
				user.updatedAt instanceof Date
					? user.updatedAt.getTime()
					: typeof user.updatedAt === 'number'
						? user.updatedAt
						: typeof user.updatedAt === 'string'
							? new Date(user.updatedAt).getTime()
							: Date.now()
			await getRuntime().startWorkflow(
				syncUserToResendWorkflow,
				{
					userId: user.id,
					email: user.email,
					name: user.name,
					updatedAtMs,
				},
				{ idempotencyKey: syncUserIdempotencyKey(user.id, updatedAtMs) }
			)
		} catch (err) {
			Sentry.captureException(err, {
				tags: { source: 'auth.databaseHooks.enqueueResendSync' },
				extra: { userId: user.id },
			})
		}
	})()
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite',
	}),
	baseURL: serverEnv.BETTER_AUTH_URL,
	secret: serverEnv.BETTER_AUTH_SECRET,
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					enqueueResendSync(user)
				},
			},
			update: {
				after: async (user) => {
					enqueueResendSync(user)
				},
			},
		},
	},
	hooks: {
		before: createAuthMiddleware(async (ctx) => {
			// Enforce server-side name length — HTML maxlength is bypassable
			if (ctx.path === '/update-user' && ctx.body?.name != null) {
				const result = profileNameSchema.safeParse(ctx.body.name)
				if (!result.success) {
					throw new APIError('BAD_REQUEST', {
						message: result.error.issues[0]?.message ?? 'Invalid name',
					})
				}
			}
		}),
	},
	plugins: [
		magicLink({
			sendMagicLink: sendMagicLinkEmail,
			expiresIn: 300, // 5 minutes
		}),
		tanstackStartCookies(), // must be the last in the plugins array
	],
	user: {
		additionalFields: {
			phone: {
				type: 'string',
				required: false,
			},
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // Update session every 24 hours
	},
	rateLimit: {
		// Better Auth enables rate limiting in production only, so local and
		// E2E sign-ins stay unthrottled. Counters are in-memory, matching the
		// single-VM deployment. These per-path rules tighten the
		// abuse-sensitive magic-link endpoints; every other path keeps the
		// library default (100 requests per 10s per IP).
		customRules: {
			// Each request dispatches an email — throttle hard per IP. The
			// per-address limiter in sendMagicLinkEmail covers distributed
			// senders targeting one inbox.
			'/sign-in/magic-link': { window: 60, max: 3 },
			// Throttles token guessing; legitimate users verify once per sign-in.
			'/magic-link/verify': { window: 60, max: 10 },
		},
	},
	advanced: {
		ipAddress: {
			// Behind Fly's proxy every socket peer is the proxy itself;
			// fly-client-ip carries the real client. x-forwarded-for covers
			// other reverse proxies (e.g. local docker).
			ipAddressHeaders: ['fly-client-ip', 'x-forwarded-for'],
		},
	},
})

export type Session = typeof auth.$Infer.Session
