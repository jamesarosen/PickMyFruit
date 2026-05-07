import { latLngToCell } from 'h3-js'
import { z } from 'zod'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import { serverEnv } from '@/lib/env.server'

const geocodingResultSchema = z.object({
	lat: z.number().gte(-90).lte(90),
	lng: z.number().gte(-180).lte(180),
	h3Index: z.string().min(1),
	displayName: z.string().min(1),
})

/** A geocoded location with H3 index and display name. */
export type GeocodingResult = z.infer<typeof geocodingResultSchema>

const nominatimResponseSchema = z.object({
	lat: z.coerce.number(),
	lon: z.coerce.number(),
	display_name: z.string(),
})

export interface GeocodingInput {
	address: string
	city: string
	state: string
	zip?: string
}

const GEOCODE_URL =
	'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'

/** Downtown Napa — anchor point for synthetic geocoding in tests. */
const MOCK_ANCHOR = { lat: 38.2975, lng: -122.2869 }

function buildQuery(input: GeocodingInput): string {
	return [input.address, input.city, input.state, input.zip]
		.filter(Boolean)
		.join(', ')
}

/** Deterministic synthetic geocoding spread around a fixed anchor. */
function mockGeocode(input: GeocodingInput): GeocodingResult {
	const query = buildQuery(input)
	let hash = 0
	for (let i = 0; i < query.length; i++) {
		hash = (hash * 31 + query.charCodeAt(i)) | 0
	}
	const lat = MOCK_ANCHOR.lat + ((hash & 0xff) - 128) * 0.0001
	const lng = MOCK_ANCHOR.lng + (((hash >> 8) & 0xff) - 128) * 0.0001
	return geocodingResultSchema.parse({
		lat,
		lng,
		h3Index: latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE),
		displayName: query,
	})
}

async function nominatimGeocode(
	input: GeocodingInput
): Promise<GeocodingResult> {
	const query = buildQuery(input)
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

	const results = z.array(nominatimResponseSchema).parse(await response.json())

	if (results.length === 0) {
		throw new Error(
			'Address not found. Please check the address and try again, or enter coordinates manually.'
		)
	}

	const [result] = results
	return geocodingResultSchema.parse({
		lat: result.lat,
		lng: result.lon,
		h3Index: latLngToCell(result.lat, result.lon, H3_RESOLUTIONS.STORAGE),
		displayName: result.display_name,
	})
}

/**
 * Geocode an address. Uses Nominatim by default; returns deterministic
 * synthetic results when GEOCODING_PROVIDER=mock.
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
	return nominatimGeocode(input)
}
