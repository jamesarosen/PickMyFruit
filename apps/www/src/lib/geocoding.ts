import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import { countryName } from '@/lib/format-location'

export const geocodingResultSchema = z.object({
	lat: z.number().gte(-90).lte(90),
	lng: z.number().gte(-180).lte(180),
})

/** A geocoded location. */
export type GeocodingResult = z.infer<typeof geocodingResultSchema>

const nominatimResponseSchema = z.object({
	lat: z.coerce.number(),
	lon: z.coerce.number(),
})

/** Address fields used as geocoding input. */
export interface GeocodingInput {
	address: string
	city: string
	state?: string
	zip?: string
	/** ISO 3166-1 alpha-2 country code. */
	country?: string
}

// Browsers cannot set User-Agent (forbidden header); Nominatim accepts the
// page Referer for identification (sent automatically) and the email param
// as an additional contact point per their ToS.
const GEOCODE_URL =
	'https://nominatim.openstreetmap.org/search?format=json&limit=1&email=help@pickmyfruit.com'

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
	// The country goes into the free-form query as a display name —
	// Nominatim matches "New Zealand" more reliably than "NZ".
	const country = input.country ? countryName(input.country) : undefined
	return [input.address, input.city, input.state, input.zip, country]
		.filter(Boolean)
		.join(', ')
}

/**
 * Geocode an address using Nominatim.
 * Adds a Sentry breadcrumb and span around each call.
 *
 * @throws {GeocodingNotFoundError} when Nominatim returns no results
 * @throws {GeocodingNetworkError} on non-2xx, fetch rejection, or non-JSON
 * @throws {GeocodingResponseError} when the response shape is unexpected
 *
 * @invariant the request to Nominatim comes directly from the browser to ensure
 * we abide by Nominatim's 1req/IP/s rate-limit.
 *
 * @todo move this server-side to prevent tampering and avoid the rate-limits.
 * This is expensive: as of 2026-05, Nominatim requires 64GB RAM and 1TB disk.
 *
 * @see `~/middleware/security-headers.ts`
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

			if (response.status === 429) {
				const retryAfter = response.headers.get('Retry-After')
				Sentry.captureMessage('geocoding.rate_limited', {
					level: 'warning',
					extra: { retryAfter },
				})
				throw new GeocodingNetworkError(
					'Geocoding service is busy, please try again in a moment (429)'
				)
			}

			// 403 from Nominatim is a policy violation or IP block — persistent,
			// not transient. Group it separately in Sentry so on-call gets the
			// right signal and the user message does not promise availability.
			if (response.status === 403) {
				const retryAfter = response.headers.get('Retry-After')
				Sentry.captureMessage('geocoding.blocked', {
					level: 'error',
					extra: { retryAfter },
				})
				throw new GeocodingNetworkError(
					'Geocoding service rejected the request (403)'
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
			})
		}
	)
}
