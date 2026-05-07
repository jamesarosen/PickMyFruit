import { latLngToCell } from 'h3-js'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import { serverEnv } from '@/lib/env.server'

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

/** Downtown Napa — used as the anchor for synthetic geocoding in tests. */
const MOCK_ANCHOR = { lat: 38.2975, lng: -122.2869 }

/**
 * Deterministic synthetic geocoding for tests. Spreads addresses around a
 * fixed anchor so different inputs produce different (but stable) coordinates.
 */
function mockGeocode(input: GeocodingInput): GeocodingResult {
	const query = [input.address, input.city, input.state, input.zip]
		.filter(Boolean)
		.join(', ')
	let hash = 0
	for (let i = 0; i < query.length; i++) {
		hash = (hash * 31 + query.charCodeAt(i)) | 0
	}
	const lat = MOCK_ANCHOR.lat + ((hash & 0xff) - 128) * 0.0001
	const lng = MOCK_ANCHOR.lng + (((hash >> 8) & 0xff) - 128) * 0.0001
	return {
		lat,
		lng,
		h3Index: latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE),
		displayName: query,
	}
}

/**
 * Geocode an address using OpenStreetMap's Nominatim API.
 * Rate limited to 1 request/second - fine for MVP.
 *
 * @throws Error if geocoding fails or no results found
 */
export async function geocodeAddress(
	input: GeocodingInput
): Promise<GeocodingResult> {
	if (serverEnv.GEOCODING_PROVIDER === 'mock') {
		return mockGeocode(input)
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
