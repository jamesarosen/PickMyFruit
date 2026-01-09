import { latLngToCell } from 'h3-js'

// H3 resolution 13 gives ~3m edge length for tree-level precision
const H3_RESOLUTION = 13

export interface GeocodingResult {
	lat: number
	lng: number
	h3Index: string
	displayName: string
}

export interface NominatimResponse {
	lat: string
	lon: string
	display_name: string
}

export interface GeocodingInput {
	address: string
	city: string
	state: string
	zip?: string
}

const GEOCODE_URL =
	'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'

/**
 * Geocode an address using OpenStreetMap's Nominatim API.
 * Rate limited to 1 request/second - fine for MVP.
 *
 * @throws Error if geocoding fails or no results found
 */
export async function geocodeAddress(
	input: GeocodingInput
): Promise<GeocodingResult> {
	const { address, city, state, zip } = input
	const query = [address, city, state, zip].filter(Boolean).join(', ')
	const url = new URL(GEOCODE_URL)
	url.searchParams.append('q', query)

	const response = await fetch(url, {
		headers: {
			'User-Agent': 'PickMyFruit/1.0 (https://pickmyfruit.com)',
		},
	})

	if (!response.ok) {
		throw new Error(`Geocoding request failed: ${response.status}`)
	}

	const results: NominatimResponse[] = await response.json()

	if (results.length === 0) {
		throw new Error(
			'Address not found. Please check the address and try again, or enter coordinates manually.'
		)
	}

	const [result] = results
	const lat = parseFloat(result.lat)
	const lng = parseFloat(result.lon)

	// Generate H3 index at tree-level precision
	const h3Index = latLngToCell(lat, lng, H3_RESOLUTION)

	return {
		lat,
		lng,
		h3Index,
		displayName: result.display_name,
	}
}
