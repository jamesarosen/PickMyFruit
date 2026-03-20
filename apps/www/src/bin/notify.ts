/**
 * Notification cron script. Run hourly via Fly.io scheduled process.
 * Queries subscriptions due for notification, finds matching listings, and sends emails.
 */
import { serverEnv } from '@/lib/env.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'
import { runAll } from '@/lib/notification-runner'

async function main(): Promise<void> {
	logger.info({}, 'Starting notification cron run')
	await runAll(serverEnv.BETTER_AUTH_URL)
	logger.info({}, 'Notification cron run complete')
}

main().catch((err) => {
	Sentry.captureException(err)
	process.exit(1)
})
