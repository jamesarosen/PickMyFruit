import { latLngToCell } from 'h3-js'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

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

// Fixed coordinates for Napa, CA — used when GEOCODING_PROVIDER=stub.
const STUB_LAT = 38.2975
const STUB_LNG = -122.2869

/**
 * Geocode an address using OpenStreetMap's Nominatim API.
 * Rate limited to 1 request/second - fine for MVP.
 * When GEOCODING_PROVIDER=stub, returns fixed Napa, CA coordinates without
 * making a network request (useful for tests and dev environments).
 *
 * @throws Error if geocoding fails or no results found
 */
export async function geocodeAddress(
	input: GeocodingInput
): Promise<GeocodingResult> {
	const { serverEnv } = await import('@/lib/env.server')
	if (serverEnv.geocoding.PROVIDER === 'stub') {
		return {
			lat: STUB_LAT,
			lng: STUB_LNG,
			h3Index: latLngToCell(STUB_LAT, STUB_LNG, H3_RESOLUTIONS.STORAGE),
			displayName: `${input.address}, ${input.city}, ${input.state}`,
		}
	}

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

	const h3Index = latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE)

	return {
		lat,
		lng,
		h3Index,
		displayName: result.display_name,
	}
}
