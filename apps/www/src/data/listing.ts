import { cellToParent } from 'h3-js'
import type { Listing } from './schema.server'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

/** Public photo shape returned to clients. */
export type PublicPhoto = { id: string; pubUrl: string; order: number }

/**
 * Coarsens a stored res-13 H3 index to the public detail resolution (8). This
 * is the only location precision exposed to non-owners and the value stored in
 * `listings.public_h3_index` for privacy-safe viewport/area queries.
 */
export function toPublicH3Index(h3Index: string): string {
	return cellToParent(h3Index, H3_RESOLUTIONS.PUBLIC_DETAIL)
}

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
	| 'publicH3Index'
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
	state: string | null
	zip: string | null
	/** ISO 3166-1 alpha-2 country code. */
	country: string
	lat: number
	lng: number
}

/**
 * Trust/guidance fields that are released under the *same* gate as the address
 * (`on_verified_request` × verified viewer). `stewardName` is security-gated:
 * it is added to the verified and owner shapes only, never to {@link
 * PublicListing}, so an anonymous or unverified viewer's payload cannot contain
 * it.
 */
export type StewardedFields = {
	/** "Maintained by {name}" trust signal — the accountable steward's display name. */
	stewardName?: string
	/** Guidance shown to a member dropping produce at a stand. */
	dropOffGuidance?: string
}

/** Guidance shown to a verified member who chooses to drop produce at a stand. */
export const DROP_OFF_GUIDANCE =
	'Drop-offs must obey local law and the listing’s restrictions. All listings are limited to raw, whole, uncut produce.'

/**
 * Public listing plus the precise street address and gated steward fields.
 * Returned to verified members for listings whose `addressReleasePolicy` is
 * `on_verified_request`, after a reveal is recorded.
 */
export type VerifiedPublicListing = PublicListing &
	RevealedAddress &
	StewardedFields

/** Full listing row plus public photo fields — returned to the listing owner only. */
export type OwnerListingView = Listing & {
	/**
	 * All photos for this listing.
	 * @invariant Sorted by `order` ascending — `photos[0]` is the cover photo.
	 */
	photos: PublicPhoto[]
}

/** Owner / steward view of a listing — the most permissive shape. */
export type PrivateListing = OwnerListingView & StewardedFields

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
		publicH3Index,
		zip: _zip,
		...safe
	} = listing
	let approximateH3Index: string
	try {
		// Prefer the stored res-8 cell (single source of truth, kept in lockstep
		// by `createListing`); fall back to deriving it for legacy rows that
		// predate the column.
		approximateH3Index = publicH3Index ?? toPublicH3Index(h3Index)
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

/**
 * Promotes a {@link PublicListing} to a {@link VerifiedPublicListing} by adding
 * the precise address and any gated steward fields. `dropOffGuidance` defaults
 * to the standard restriction text when the listing accepts drop-offs.
 */
export function toVerifiedPublicListing(
	publicListing: PublicListing,
	address: RevealedAddress,
	steward: StewardedFields = {}
): VerifiedPublicListing {
	const dropOffGuidance =
		steward.dropOffGuidance ??
		(publicListing.acceptsDropOffs ? DROP_OFF_GUIDANCE : undefined)
	return {
		...publicListing,
		...address,
		...(steward.stewardName ? { stewardName: steward.stewardName } : {}),
		...(dropOffGuidance ? { dropOffGuidance } : {}),
	}
}

/**
 * Picks the listing shape to present to a viewer. Owners always see the
 * private (full) shape. For non-owners, `on_owner_approval` listings stay
 * public (the existing inquiry flow gates address release); verified members
 * looking at `on_verified_request` listings see the address.
 *
 * `ownerName`, when supplied, is surfaced as the gated `stewardName` on the
 * verified and owner shapes only — it is never added to {@link PublicListing},
 * so an anonymous or unverified viewer's payload cannot contain it.
 *
 * Returns `null` when the listing cannot be projected (invalid h3 index).
 */
export function listingShapeFor(
	listing: Listing,
	viewer: ListingViewer,
	photos: PublicPhoto[] = [],
	onError?: (listingId: number, error: unknown) => void,
	ownerName?: string
): ListingShape | null {
	if (viewer.userId && viewer.userId === listing.userId) {
		const owner: PrivateListing = { ...listing, photos }
		if (ownerName) owner.stewardName = ownerName
		return owner
	}
	const pub = toPublicListing(listing, photos, onError)
	if (!pub) return null
	if (
		listing.addressReleasePolicy === 'on_verified_request' &&
		viewer.emailVerified
	) {
		return toVerifiedPublicListing(
			pub,
			{
				address: listing.address,
				city: listing.city,
				state: listing.state,
				zip: listing.zip,
				country: listing.country,
				lat: listing.lat,
				lng: listing.lng,
			},
			ownerName ? { stewardName: ownerName } : {}
		)
	}
	return pub
}
