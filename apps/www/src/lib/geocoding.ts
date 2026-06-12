import { z } from 'zod'

export const geocodingResultSchema = z.object({
	lat: z.number().gte(-90).lte(90),
	lng: z.number().gte(-180).lte(180),
})

/** A geocoded location. */
export type GeocodingResult = z.infer<typeof geocodingResultSchema>

/** A geocoded location plus the server's provenance token (see geocode-token.server.ts). */
export interface SignedGeocodingResult extends GeocodingResult {
	geocodeTs: number
	geocodeSig: string
}

/** Address fields used as geocoding input. */
export interface GeocodingInput {
	address: string
	city: string
	state: string
	zip?: string
}

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

/**
 * Geocode an address. The lookup runs server-side (src/lib/geocoding.server.ts)
 * so Nominatim sees one well-behaved client and the returned coordinates are
 * HMAC-signed against the address — createListing rejects tampered values.
 *
 * @throws {GeocodingNotFoundError} when the geocoder finds no results
 * @throws {GeocodingNetworkError} on rate limits or service failures
 */
export async function geocodeAddress(
	input: GeocodingInput
): Promise<SignedGeocodingResult> {
	const { requestGeocode } = await import('@/api/geocoding')
	const result = await requestGeocode({ data: input })

	if (result.ok) {
		return {
			lat: result.lat,
			lng: result.lng,
			geocodeTs: result.ts,
			geocodeSig: result.sig,
		}
	}

	if (result.code === 'NOT_FOUND') {
		throw new GeocodingNotFoundError()
	}
	if (result.code === 'RATE_LIMITED') {
		throw new GeocodingNetworkError(
			'Geocoding service is busy, please try again in a moment'
		)
	}
	throw new GeocodingNetworkError('Geocoding request failed')
}
