import { latLngToCell } from 'h3-js'
import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

export const geocodingResultSchema = z.object({
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

/** Address fields used as geocoding input. */
export interface GeocodingInput {
	address: string
	city: string
	state: string
	zip?: string
}

const GEOCODE_URL =
	'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us'

/** Nominatim returned an empty result set — user input issue, not a bug. */
export class GeocodingNotFoundError extends Error {
	constructor() {
		super(
			'Address not found. Please check the address and try again, or enter coordinates manually.'
		)
		this.name = 'GeocodingNotFoundError'
	}
}

/** Network-level failure (non-2xx, fetch rejection, non-JSON body). */
export class GeocodingNetworkError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'GeocodingNetworkError'
	}
}

/** Nominatim returned an unexpected response shape — schema parse failure. */
export class GeocodingResponseError extends Error {
	constructor(
		message: string,
		public readonly rawResponse: string
	) {
		super(message)
		this.name = 'GeocodingResponseError'
	}
}

function buildQuery(input: GeocodingInput): string {
	return [input.address, input.city, input.state, input.zip]
		.filter(Boolean)
		.join(', ')
}

/**
 * Geocode an address using Nominatim from the browser.
 * Adds a Sentry breadcrumb and span around each call.
 *
 * @throws {GeocodingNotFoundError} when Nominatim returns no results
 * @throws {GeocodingNetworkError} on non-2xx, fetch rejection, or non-JSON
 * @throws {GeocodingResponseError} when the response shape is unexpected
 */
export async function geocodeAddress(
	input: GeocodingInput
): Promise<GeocodingResult> {
	const query = buildQuery(input)

	Sentry.addBreadcrumb({
		category: 'geocoding',
		level: 'info',
		data: { query },
	})

	return Sentry.startSpan(
		{ name: 'geocoding.nominatim', op: 'http.client' },
		async () => {
			const url = new URL(GEOCODE_URL)
			url.searchParams.append('q', query)

			let response: Response
			try {
				response = await fetch(url.toString())
			} catch (err) {
				throw new GeocodingNetworkError(
					err instanceof Error ? err.message : 'Network error during geocoding'
				)
			}

			if (response.status === 403 || response.status === 429) {
				const retryAfter = response.headers.get('Retry-After')
				Sentry.captureMessage('geocoding.rate_limited', {
					level: 'warning',
					extra: { status: response.status, retryAfter },
				})
				throw new GeocodingNetworkError(
					`Geocoding service temporarily unavailable (${response.status})`
				)
			}

			if (!response.ok) {
				throw new GeocodingNetworkError(
					`Geocoding request failed: ${response.status}`
				)
			}

			let rawText: string
			try {
				rawText = await response.text()
			} catch {
				throw new GeocodingNetworkError('Failed to read geocoding response body')
			}

			let json: unknown
			try {
				json = JSON.parse(rawText)
			} catch {
				const raw = rawText.slice(0, 1024)
				const err = new GeocodingResponseError(
					'Geocoding response was not valid JSON',
					raw
				)
				Sentry.captureException(err, { extra: { rawResponse: raw } })
				throw err
			}

			let results: z.infer<typeof nominatimResponseSchema>[]
			try {
				results = z.array(nominatimResponseSchema).parse(json)
			} catch {
				const raw = rawText.slice(0, 1024)
				const err = new GeocodingResponseError(
					'Geocoding response did not match expected schema',
					raw
				)
				Sentry.captureException(err, { extra: { rawResponse: raw } })
				throw err
			}

			if (results.length === 0) {
				throw new GeocodingNotFoundError()
			}

			const [result] = results
			return geocodingResultSchema.parse({
				lat: result.lat,
				lng: result.lon,
				h3Index: latLngToCell(result.lat, result.lon, H3_RESOLUTIONS.STORAGE),
				displayName: result.display_name,
			})
		}
	)
}
