import { Sentry } from '@/lib/sentry'
import type { Listing } from '@/data/schema'

/** Summary returned by each run. */
export interface RunSummary {
	period: 'immediately' | 'weekly'
	sent: number
	skipped: number
	errors: number
}

/** Cutoff date for the "immediately" period: 1 hour ago. */
function immediateCutoff(): Date {
	return new Date(Date.now() - 60 * 60 * 1000)
}

/** Cutoff date for the "weekly" period: 7 days ago. */
function weeklyCutoff(): Date {
	return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
}

/** Processes notifications for one throttle period. */
export async function runForThrottlePeriod(
	throttlePeriod: 'immediately' | 'weekly',
	cutoff: Date
): Promise<RunSummary> {
	const { logger } = await import('@/lib/logger.server')
	const { serverEnv } = await import('@/lib/env.server')
	const {
		getNotificationSubscriptionsDue,
		getAvailableListingsForNotifications,
		markSubscriptionNotified,
		getUserById,
	} = await import('@/data/queries.server')
	const { subscriptionMatchesListing } =
		await import('@/lib/subscription-matcher')
	const { sendNotificationEmail } = await import('@/lib/email-templates.server')
	const { signUnsubscribeUrl } = await import('@/lib/hmac.server')

	const baseUrl = serverEnv.BETTER_AUTH_URL.replace(/\/$/, '')

	const subscriptions = await getNotificationSubscriptionsDue(
		throttlePeriod,
		cutoff
	)
	const allListings: Listing[] = await getAvailableListingsForNotifications(500)

	type SubResult = 'sent' | 'skipped' | { error: unknown }

	async function processSubscription(
		sub: (typeof subscriptions)[number]
	): Promise<SubResult> {
		try {
			const matchingListings = allListings.filter((listing) =>
				subscriptionMatchesListing(sub, listing)
			)

			if (matchingListings.length === 0) {
				return 'skipped'
			}

			const owner = await getUserById(sub.userId)
			if (!owner) {
				logger.warn({ subscriptionId: sub.id }, 'Subscription owner not found')
				return 'skipped'
			}

			const unsubscribeUrl = signUnsubscribeUrl(baseUrl, sub.id)

			await sendNotificationEmail({
				to: owner.email,
				subscription: {
					id: sub.id,
					placeName: sub.placeName,
					throttlePeriod,
				},
				listings: matchingListings.map((l) => ({
					id: l.id,
					name: l.name,
					type: l.type,
					city: l.city,
					state: l.state,
				})),
				unsubscribeUrl,
				baseUrl,
			})

			await markSubscriptionNotified(sub.id)
			return 'sent'
		} catch (error) {
			Sentry.captureException(error, { extra: { subscriptionId: sub.id } })
			return { error }
		}
	}

	const results = await Promise.all(
		subscriptions.map((sub) => processSubscription(sub))
	)

	const summary: RunSummary = {
		period: throttlePeriod,
		sent: 0,
		skipped: 0,
		errors: 0,
	}
	for (const result of results) {
		if (result === 'sent') {
			summary.sent++
		} else if (result === 'skipped') {
			summary.skipped++
		} else {
			summary.errors++
		}
	}

	logger.info(summary, 'Notification run complete')
	return summary
}

/** Runs notifications for all throttle periods sequentially. */
export async function runAll(): Promise<RunSummary[]> {
	const immediate = await runForThrottlePeriod('immediately', immediateCutoff())
	const weekly = await runForThrottlePeriod('weekly', weeklyCutoff())
	return [immediate, weekly]
}
