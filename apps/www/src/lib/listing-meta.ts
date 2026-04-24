import { produceTypes } from '@/lib/produce-types'

/**
 * Open Graph / Twitter title and description for a listing detail page. Kept
 * short enough to survive Twitter/X truncation (title ≤ 70 chars,
 * description ≤ 200 chars; both aim well under typical display cutoffs of
 * ~55 chars for title and ~160 chars for description).
 */
export interface ListingMeta {
	title: string
	description: string
}

/** Input shape accepted by `buildListingMeta` — a subset of listing fields. */
export interface ListingMetaInput {
	type: string
	city: string
	state: string
	variety?: string | null
}

/**
 * Returns undefined when the input cannot produce a meaningful listing-specific
 * title — callers should fall back to the site defaults in that case.
 */
export function buildListingMeta(
	listing: ListingMetaInput | null | undefined
): ListingMeta | undefined {
	if (!listing) return undefined
	const produce = produceTypes.find((t) => t.slug === listing.type)
	if (!produce) return undefined

	const title = `Pick My ${produce.namePluralTitleCase}`

	const varietyPhrase = listing.variety ? `${listing.variety} ` : ''
	const location =
		listing.city && listing.state ? ` in ${listing.city}, ${listing.state}` : ''
	const description = `Fresh ${varietyPhrase}${produce.namePluralSentenceCase} ready to share${location}. Claim them before they go to waste.`

	return { title, description }
}
