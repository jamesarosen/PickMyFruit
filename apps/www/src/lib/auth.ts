import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start/solid'
import { db } from '../data/db'
import { serverEnv } from './env.server'

const sendMagicLinkEmail = async ({
	email,
	url,
	token,
}: {
	email: string
	url: string
	token: string
}) => {
	if (!serverEnv.RESEND_API_KEY) {
		if (serverEnv.LOG_DEV_EMAILS) {
			console.log('\n========================================')
			console.log('MAGIC LINK (dev mode - no RESEND_API_KEY)')
			console.log('========================================')
			console.log(`Email: ${email}`)
			console.log(`URL: ${url}`)
			console.log(`Token: ${token}`)
			console.log('========================================\n')
		}
		return
	}

	const { Resend } = await import('resend')
	const resend = new Resend(serverEnv.RESEND_API_KEY)

	await resend.emails.send({
		from: serverEnv.EMAIL_FROM || 'Pick My Fruit <noreply@pickmyfruit.com>',
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

export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: 'sqlite',
	}),
	baseURL: serverEnv.BETTER_AUTH_URL,
	secret: serverEnv.BETTER_AUTH_SECRET,
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
})

export type Session = typeof auth.$Infer.Session
