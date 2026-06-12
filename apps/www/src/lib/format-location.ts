/** The address fields a location line is built from. */
export interface ListingLocationFields {
	city: string
	state: string | null
	/** ISO 3166-1 alpha-2 country code. */
	country: string
}

const regionNames = new Intl.DisplayNames(['en'], {
	type: 'region',
	fallback: 'code',
})

/** English display name for an ISO 3166-1 alpha-2 code, e.g. "FR" → "France". */
export function countryName(code: string): string {
	// Intl.DisplayNames throws on codes that don't match the grammar (e.g.
	// digits); fall back to the raw code rather than break a listing page.
	try {
		return regionNames.of(code) ?? code
	} catch {
		return code
	}
}

/**
 * Renders a listing's location line, e.g. "Napa, CA" or "Paris, France".
 * The country is shown for non-US listings only; empty and repeated parts
 * are dropped.
 */
export function formatListingLocation(fields: ListingLocationFields): string {
	const candidates = [
		fields.city,
		fields.state,
		fields.country === 'US' ? null : countryName(fields.country),
	]
	const parts: string[] = []
	for (const part of candidates) {
		if (part && !parts.includes(part)) parts.push(part)
	}
	return parts.join(', ')
}
