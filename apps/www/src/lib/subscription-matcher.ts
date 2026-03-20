import { gridDisk, isValidCell, cellToParent, getResolution } from 'h3-js'
import type { NotificationSubscription } from '@/data/schema'
import type { PublicListing } from '@/data/queries'
import { Sentry } from '@/lib/sentry'

/**
 * Returns the set of H3 cells (at subscription resolution) covered by a subscription.
 * The center cell plus all cells within `ringSize` rings are included.
 */
export function getSubscriptionCells(
	subscription: Pick<NotificationSubscription, 'centerH3' | 'ringSize'>
): Set<string> {
	if (!isValidCell(subscription.centerH3)) {
		return new Set()
	}
	const cells = gridDisk(subscription.centerH3, subscription.ringSize)
	return new Set(cells)
}

/**
 * Returns true if a listing falls within the subscription's geographic coverage area.
 * The listing's approximateH3Index (at res 8) is compared at the subscription's resolution.
 */
export function listingMatchesSubscription(
	listing: Pick<PublicListing, 'approximateH3Index'>,
	subscription: Pick<
		NotificationSubscription,
		'centerH3' | 'resolution' | 'ringSize'
	>
): boolean {
	if (!isValidCell(listing.approximateH3Index)) {
		return false
	}
	const cells = getSubscriptionCells(subscription)
	if (cells.size === 0) {
		return false
	}

	const subRes = subscription.resolution
	const listingRes = getResolution(listing.approximateH3Index)

	// If subscription resolution is coarser than (or equal to) the listing resolution,
	// get the listing's parent cell at the subscription resolution for comparison.
	// If subscription resolution is somehow finer than the listing cell's resolution,
	// keep the listing cell as-is (cannot go finer than already stored).
	const listingAtSubRes =
		subRes <= listingRes
			? cellToParent(listing.approximateH3Index, subRes)
			: listing.approximateH3Index

	return cells.has(listingAtSubRes)
}

/**
 * Returns true if a listing's produce type matches the subscription's filter.
 * A null `produceTypes` field means "all types match". An empty array also matches all.
 */
export function listingMatchesProduceFilter(
	listing: Pick<PublicListing, 'type'>,
	subscription: Pick<NotificationSubscription, 'produceTypes'>
): boolean {
	if (!subscription.produceTypes) {
		return true
	}
	let types: unknown
	try {
		types = JSON.parse(subscription.produceTypes)
	} catch (err) {
		Sentry.captureException(err, {
			extra: { produceTypes: subscription.produceTypes },
		})
		// Unparseable value — default to match-all so the subscription still fires
		return true
	}
	if (!Array.isArray(types) || !types.every((t) => typeof t === 'string')) {
		Sentry.captureException(new Error('produceTypes is not a string[]'), {
			extra: { produceTypes: subscription.produceTypes },
		})
		return true
	}
	if (types.length === 0) {
		return true
	}
	return types.includes(listing.type)
}
