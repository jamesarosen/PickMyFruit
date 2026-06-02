import { cellToParent } from 'h3-js'
import type { Listing } from './schema.server'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

/** Public photo shape returned to clients. */
export type PublicPhoto = { id: string; pubUrl: string; order: number }

/** Public listing fields safe to expose to any visitor. */
export type PublicListing = Omit<
	Listing,
	| 'userId'
	| 'address'
	| 'accessInstructions'
	| 'deletedAt'
	| 'lat'
	| 'lng'
	| 'h3Index'
	| 'zip'
> & {
	approximateH3Index: string
	/**
	 * All photos for this listing.
	 * @invariant Sorted by `order` ascending — `photos[0]` is the cover photo.
	 */
	photos: PublicPhoto[]
}

/** Address fields released to a verified viewer of an `on_verified_request` listing. */
export type RevealedAddress = {
	address: string
	city: string
	state: string
	zip: string | null
}

/**
 * Public listing plus the precise street address. Returned to verified
 * members for listings whose `addressReleasePolicy` is `on_verified_request`,
 * after a reveal is recorded.
 */
export type VerifiedPublicListing = PublicListing & RevealedAddress

/** Full listing row plus public photo fields — returned to the listing owner only. */
export type OwnerListingView = Listing & {
	/**
	 * All photos for this listing.
	 * @invariant Sorted by `order` ascending — `photos[0]` is the cover photo.
	 */
	photos: PublicPhoto[]
}

/** Owner / steward view of a listing — the most permissive shape. */
export type PrivateListing = OwnerListingView

/** The minimum viewer information needed to decide which shape to present. */
export type ListingViewer = {
	userId: string | null
	emailVerified: boolean
}

export type ListingShape =
	| PublicListing
	| VerifiedPublicListing
	| PrivateListing

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
		userId: _userId,
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
		photos,
	}
}

/** Promotes a {@link PublicListing} to a {@link VerifiedPublicListing} by adding the precise address. */
export function toVerifiedPublicListing(
	publicListing: PublicListing,
	address: RevealedAddress
): VerifiedPublicListing {
	return { ...publicListing, ...address }
}

/**
 * Picks the listing shape to present to a viewer. Owners always see the
 * private (full) shape. For non-owners, `on_owner_approval` listings stay
 * public (the existing inquiry flow gates address release); verified members
 * looking at `on_verified_request` listings see the address.
 *
 * Returns `null` when the listing cannot be projected (invalid h3 index).
 */
export function listingShapeFor(
	listing: Listing,
	viewer: ListingViewer,
	photos: PublicPhoto[] = [],
	onError?: (listingId: number, error: unknown) => void
): ListingShape | null {
	if (viewer.userId && viewer.userId === listing.userId) {
		return { ...listing, photos }
	}
	const pub = toPublicListing(listing, photos, onError)
	if (!pub) return null
	if (
		listing.addressReleasePolicy === 'on_verified_request' &&
		viewer.emailVerified
	) {
		return toVerifiedPublicListing(pub, {
			address: listing.address,
			city: listing.city,
			state: listing.state,
			zip: listing.zip,
		})
	}
	return pub
}
