import { cellToParent } from 'h3-js'
import type { Listing } from './schema'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

/** Public photo shape returned to clients. */
export type PublicPhoto = { id: string; pubUrl: string; order: number }

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
> & {
	approximateH3Index: string
	/** Public URL of the first photo by order, or null if none. */
	coverPhotoUrl: string | null
	/** All photos for this listing, ordered by `order`. */
	photos: PublicPhoto[]
}

/** Full listing row plus public photo fields — returned to the listing owner only. */
export type OwnerListingView = Listing & {
	coverPhotoUrl: string | null
	photos: PublicPhoto[]
}

/**
 * Strips sensitive location fields and coarsens h3Index to neighborhood precision.
 * Returns null if the h3Index is invalid so callers can skip bad rows.
 */
export function toPublicListing(
	listing: Listing,
	photos: PublicPhoto[] = [],
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
		approximateH3Index = cellToParent(h3Index, H3_RESOLUTIONS.PUBLIC_DETAIL)
	} catch (error) {
		onError?.(listing.id, error)
		return null
	}
	return {
		...safe,
		approximateH3Index,
		coverPhotoUrl: photos[0]?.pubUrl ?? null,
		photos,
	}
}
