import { latLngToCell } from 'h3-js'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import { serverEnv } from '@/lib/env.server'

/** Thrown when Nominatim returns a 429 or 5xx status. */
export class GeocodingError extends Error {
	constructor(
		public readonly status: number,
		address: string
	) {
		super(`Geocoding failed (HTTP ${status}) for: ${address}`)
		this.name = 'GeocodingError'
	}
}

/** Result returned when geocoding succeeds. */
export interface GeocodingResult {
	lat: number
	lng: number
	/** H3 index at {@link H3_RESOLUTIONS.STORAGE} (resolution 13). */
	h3Index: string
	displayName: string
}

/** Structured address input, used for listing creation. */
export interface GeocodingInput {
	address: string
	city: string
	state: string
	zip?: string
}

interface NominatimResponse {
	lat: string
	lon: string
	display_name: string
}

const GEOCODE_URL =
	'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'

const TIMEOUT_MS = 10_000

async function doGeocode(
	query: string,
	signal?: AbortSignal
): Promise<GeocodingResult | null> {
	const url = new URL(GEOCODE_URL)
	url.searchParams.append('q', query)

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
	signal?.addEventListener('abort', () => controller.abort(), { once: true })

	let response: Response
	try {
		response = await fetch(url, {
			headers: { 'User-Agent': serverEnv.NOMINATIM_USER_AGENT },
			signal: controller.signal,
		})
	} catch (error) {
		clearTimeout(timer)
		throw error
	}
	clearTimeout(timer)

	if (response.status === 429 || response.status >= 500) {
		throw new GeocodingError(response.status, query)
	}

	if (!response.ok) {
		throw new GeocodingError(response.status, query)
	}

	const results: NominatimResponse[] = await response.json()

	if (results.length === 0) {
		return null
	}

	const [result] = results
	const lat = parseFloat(result.lat)
	const lng = parseFloat(result.lon)
	const h3Index = latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE)

	return { lat, lng, h3Index, displayName: result.display_name }
}

/**
 * Geocodes a structured address or a plain string query using Nominatim.
 *
 * - Returns `null` when no results are found.
 * - Throws {@link GeocodingError} on 429 (rate-limited) or 5xx responses.
 * - Applies a 10-second timeout; an optional `AbortSignal` can cancel earlier.
 */
export async function geocodeAddress(
	input: GeocodingInput | string,
	options?: { signal?: AbortSignal }
): Promise<GeocodingResult | null> {
	const query =
		typeof input === 'string'
			? input
			: [input.address, input.city, input.state, input.zip]
					.filter(Boolean)
					.join(', ')

	return doGeocode(query, options?.signal)
}
