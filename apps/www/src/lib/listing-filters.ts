import { listingMatchesArea } from './h3-area'
import { produceTypeSlugs, produceTypes } from './produce-types'

/** Returns the slug if it names a known produce type, else null (filter ignored). */
export function normalizeTypeFilter(
	type: string | null | undefined
): string | null {
	if (!type) return null
	return produceTypeSlugs.has(type) ? type : null
}

/** The listing fields the home-page filters inspect. */
export type FilterableListing = {
	approximateH3Index: string
	type: string
}

/** Applies the area and produce-type filters; null/absent filters pass everything. */
export function filterListings<T extends FilterableListing>(
	listings: T[],
	area: string | null,
	type: string | null
): T[] {
	return listings.filter(
		(listing) =>
			(!area || listingMatchesArea(listing.approximateH3Index, area)) &&
			(!type || listing.type === type)
	)
}

/**
 * Distinct produce types present in the given listings, in catalog
 * (alphabetical) order, with display labels for filter chips.
 */
export function presentTypes(
	listings: FilterableListing[]
): Array<{ slug: string; label: string }> {
	const present = new Set(listings.map((listing) => listing.type))
	return produceTypes
		.filter((t) => present.has(t.slug))
		.map((t) => ({ slug: t.slug, label: t.namePluralTitleCase }))
}
