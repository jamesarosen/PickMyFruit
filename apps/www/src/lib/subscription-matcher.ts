import { gridDisk, cellToParent } from 'h3-js'
import { Sentry } from '@/lib/sentry'
import type { Listing, NotificationSubscription } from '@/data/schema'

/**
 * Returns true if a listing falls within a subscription's geographic area
 * and matches its produce-type filter (if any).
 *
 * Malformed `produceTypes` JSON is captured to Sentry and returns false (skip,
 * not match-all) to avoid flooding subscribers with unintended emails.
 */
export function subscriptionMatchesListing(
	subscription: NotificationSubscription,
	listing: Listing
): boolean {
	// Convert the listing's high-res cell to the subscription's resolution
	let listingCell: string
	try {
		listingCell = cellToParent(listing.h3Index, subscription.resolution)
	} catch {
		return false
	}

	// Check geographic containment
	const coverageCells = gridDisk(subscription.centerH3, subscription.ringSize)
	if (!coverageCells.includes(listingCell)) {
		return false
	}

	// No produce-type filter → match any type
	if (!subscription.produceTypes) {
		return true
	}

	// Validate and apply produce-type filter
	let types: string[]
	try {
		const parsed = JSON.parse(subscription.produceTypes) as unknown
		if (!Array.isArray(parsed)) throw new Error('produceTypes is not an array')
		types = parsed as string[]
	} catch (error) {
		Sentry.captureException(error, {
			extra: {
				subscriptionId: subscription.id,
				produceTypes: subscription.produceTypes,
			},
		})
		return false
	}

	return types.includes(listing.type)
}
