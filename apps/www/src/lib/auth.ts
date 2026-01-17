import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { db } from '../data/db'

// Conditionally import Resend only if API key is available
const sendMagicLinkEmail = async ({
	email,
	url,
	token,
}: {
	email: string
	url: string
	token: string
}) => {
	const resendApiKey = process.env.RESEND_API_KEY

	if (!resendApiKey) {
		// Development mode: log to console
		console.log('\n========================================')
		console.log('MAGIC LINK (dev mode - no RESEND_API_KEY)')
		console.log('========================================')
		console.log(`Email: ${email}`)
		console.log(`URL: ${url}`)
		console.log(`Token: ${token}`)
		console.log('========================================\n')
		return
	}

	// Production mode: send via Resend
	const { Resend } = await import('resend')
	const resend = new Resend(resendApiKey)

	await resend.emails.send({
		from: process.env.EMAIL_FROM || 'Pick My Fruit <noreply@pickmyfruit.com>',
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
	<a href="${url}" style="display: inline-block; padding: 14px 28px; background: #4a7c23; color: white; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 16px 0;">Sign In</a>
	<p style="color: #666; font-size: 14px; margin-top: 24px;">This link expires in 5 minutes. If you didn't request this, you can safely ignore this email.</p>
</body>
</html>
		`.trim(),
	})
}

// Development fallback for BETTER_AUTH_SECRET
const secret = process.env.BETTER_AUTH_SECRET
if (!secret && process.env.NODE_ENV === 'production') {
	throw new Error('BETTER_AUTH_SECRET must be set in production')
}
if (!secret) {
	console.warn(
		'[auth] BETTER_AUTH_SECRET not set, using insecure development default'
	)
}

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite',
	}),
	baseURL: process.env.BETTER_AUTH_URL,
	secret: secret || 'dev-secret-do-not-use-in-production-min32chars',
	plugins: [
		magicLink({
			sendMagicLink: sendMagicLinkEmail,
			expiresIn: 300, // 5 minutes
		}),
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
})

export type Session = typeof auth.$Infer.Session
