/** Result from geocoding an address string. */
export interface GeocodeResult {
	lat: number
	lng: number
	displayName: string
}

/** Geocodes a query string using Nominatim. Returns null if no results found.
 * Throws `DOMException` with name `"AbortError"` if `signal` is aborted or the
 * 10-second timeout elapses.
 */
export async function geocodeAddress(
	query: string,
	signal?: AbortSignal
): Promise<GeocodeResult | null> {
	const url = new URL('https://nominatim.openstreetmap.org/search')
	url.searchParams.set('q', query)
	url.searchParams.set('format', 'json')
	url.searchParams.set('limit', '1')

	const timeout = AbortSignal.timeout(10_000)
	const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

	const response = await fetch(url.toString(), {
		signal: combinedSignal,
		headers: { 'Accept-Language': 'en', 'User-Agent': 'PickMyFruit/1.0' },
	})

	if (!response.ok) {
		return null
	}

	const results = await response.json()
	if (!Array.isArray(results) || results.length === 0) {
		return null
	}

	const [first] = results
	return {
		lat: parseFloat(first.lat),
		lng: parseFloat(first.lon),
		displayName: first.display_name,
	}
}
