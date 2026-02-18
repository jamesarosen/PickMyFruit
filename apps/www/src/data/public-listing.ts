import { cellToParent } from 'h3-js'
import type { Listing } from './schema'

// ~1.2km hexagons — neighborhood-level, prevents identifying the exact property
const PUBLIC_H3_RESOLUTION = 7

/** Public listing fields safe to expose to any visitor. */
export type PublicListing = Omit<
	Listing,
	| 'address'
	| 'accessInstructions'
	| 'deletedAt'
	| 'lat'
	| 'lng'
	| 'h3Index'
	| 'zip'
> & { approximateH3Index: string }

/**
 * Strips sensitive location fields and coarsens h3Index to ~1.2km precision.
 * Returns null if the h3Index is invalid so callers can skip bad rows.
 */
export function toPublicListing(
	listing: Listing,
	onError?: (listingId: number, error: unknown) => void
): PublicListing | null {
	const {
		address: _address,
		accessInstructions: _accessInstructions,
		deletedAt: _deletedAt,
		lat: _lat,
		lng: _lng,
		h3Index,
		zip: _zip,
		...safe
	} = listing
	let approximateH3Index: string
	try {
		approximateH3Index = cellToParent(h3Index, PUBLIC_H3_RESOLUTION)
	} catch (error) {
		onError?.(listing.id, error)
		return null
	}
	return { ...safe, approximateH3Index }
}
