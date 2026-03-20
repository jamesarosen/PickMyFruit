/**
 * Core notification processing logic, extracted from the cron entry point so it
 * can be imported and tested independently of the bin script bootstrapping.
 */
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'
import {
	ThrottlePeriod,
	type ThrottlePeriodValue,
	type NotificationSubscription,
} from '@/data/schema'
import {
	getSubscriptionsDue,
	markSubscriptionNotified,
	getAvailableListings,
	getUserById,
	type PublicListing,
} from '@/data/queries'
import { sendNotificationEmail } from '@/lib/email-templates'

/** Matches the signature of sendNotificationEmail for injection in tests. */
export type EmailSender = typeof sendNotificationEmail

async function processSubscription(
	sub: NotificationSubscription,
	allListings: PublicListing[],
	throttlePeriod: ThrottlePeriodValue,
	baseUrl: string,
	sendEmail: EmailSender
): Promise<void> {
	const { listingMatchesSubscription, listingMatchesProduceFilter } =
		await import('@/lib/subscription-matcher')

	const matchingListings = allListings.filter(
		(listing) =>
			listingMatchesSubscription(listing, sub) &&
			listingMatchesProduceFilter(listing, sub)
	)

	if (matchingListings.length === 0) {
		logger.info({ subscriptionId: sub.id }, 'No matching listings, skipping')
		return
	}

	const subscriber = await getUserById(sub.userId)
	if (!subscriber) {
		logger.info(
			{ subscriptionId: sub.id, userId: sub.userId },
			'User not found, skipping'
		)
		return
	}

	// Send before marking so that a send failure leaves the subscription eligible
	// for the next cron run (at-least-once delivery). The idempotency key ensures
	// Resend deduplicates within 24 hours if markSubscriptionNotified fails and
	// the same subscription is retried before the throttle window expires.
	const idempotencyKey = `notify-${sub.id}-${new Date().toISOString().slice(0, 10)}`
	await sendEmail({
		baseUrl,
		subscriber,
		subscriptionId: sub.id,
		userId: sub.userId,
		throttlePeriod,
		idempotencyKey,
		listings: matchingListings.map((l) => ({
			id: l.id,
			type: l.type,
			quantity: l.quantity,
			harvestWindow: l.harvestWindow,
			city: l.city,
			state: l.state,
		})),
	})

	await markSubscriptionNotified(sub.id)
	logger.info(
		{ subscriptionId: sub.id, listingCount: matchingListings.length },
		'Notification sent'
	)
}

/** Processes all subscriptions due for the given throttle period. */
export async function runForThrottlePeriod(
	throttlePeriod: ThrottlePeriodValue,
	baseUrl: string,
	sendEmail: EmailSender = sendNotificationEmail
): Promise<void> {
	const subscriptions = await getSubscriptionsDue(throttlePeriod)
	logger.info(
		{ throttlePeriod, count: subscriptions.length },
		'Processing subscriptions'
	)

	if (subscriptions.length === 0) {
		return
	}

	const allListings = await getAvailableListings()
	logger.info(
		{ throttlePeriod, listingCount: allListings.length },
		'Fetched available listings'
	)

	await Promise.all(
		subscriptions.map(async (sub) => {
			try {
				await processSubscription(
					sub,
					allListings,
					throttlePeriod,
					baseUrl,
					sendEmail
				)
			} catch (err) {
				Sentry.captureException(err, { extra: { subscriptionId: sub.id } })
			}
		})
	)
}

/** Runs all three throttle periods. Entry point for the cron script. */
export async function runAll(
	baseUrl: string,
	sendEmail: EmailSender = sendNotificationEmail
): Promise<void> {
	await Promise.all([
		runForThrottlePeriod(ThrottlePeriod.hourly, baseUrl, sendEmail),
		runForThrottlePeriod(ThrottlePeriod.daily, baseUrl, sendEmail),
		runForThrottlePeriod(ThrottlePeriod.weekly, baseUrl, sendEmail),
	])
}
