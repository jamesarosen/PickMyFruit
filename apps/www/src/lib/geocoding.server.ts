import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import { serverEnv } from '@/lib/env.server'
import { createSlidingWindowLimiter } from '@/lib/rate-limit.server'
import { signGeocodeResult } from '@/lib/geocode-token.server'
import {
	GeocodingNetworkError,
	GeocodingNotFoundError,
	GeocodingResponseError,
	geocodingResultSchema,
	type GeocodingInput,
	type GeocodingResult,
} from '@/lib/geocoding'

const nominatimResponseSchema = z.object({
	lat: z.coerce.number(),
	lon: z.coerce.number(),
})

// Nominatim's usage policy requires an identifying User-Agent (browsers
// cannot set one — a reason this call lives server-side) and at most one
// request per second from the whole service.
const USER_AGENT =
	'PickMyFruit/1.0 (https://www.pickmyfruit.com; help@pickmyfruit.com)'

const QUERY_PARAMS = 'format=json&limit=1&countrycodes=us'

/** Per-client cap; generous for humans correcting typos, hostile to scripts. */
const perIpLimiter = createSlidingWindowLimiter({
	windowMs: 60_000,
	max: 10,
})

/** Whole-service cap enforcing Nominatim's 1 req/s policy. */
const nominatimPolicyLimiter = createSlidingWindowLimiter({
	windowMs: 1_000,
	max: 1,
})

/** Discriminated result for the client: no error-class serialization across the RPC boundary. */
export type GeocodeForClientResult =
	| { ok: true; lat: number; lng: number; ts: number; sig: string }
	| { ok: false; code: 'NOT_FOUND' | 'RATE_LIMITED' | 'UNAVAILABLE' }

function clientIpFrom(headers: Headers): string {
	return (
		headers.get('fly-client-ip') ??
		headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'unknown'
	)
}

/**
 * Rate-limited geocoding for the listing form. Successful results carry an
 * HMAC token binding the coordinates to the address (geocode-token.server.ts)
 * so the create endpoint can verify them without re-geocoding.
 */
export async function geocodeForClient(
	input: GeocodingInput,
	headers: Headers
): Promise<GeocodeForClientResult> {
	if (
		!perIpLimiter.attempt(clientIpFrom(headers)) ||
		!nominatimPolicyLimiter.attempt('nominatim')
	) {
		return { ok: false, code: 'RATE_LIMITED' }
	}

	try {
		const { lat, lng } = await fetchGeocode(input)
		const { ts, sig } = signGeocodeResult(input, lat, lng)
		return { ok: true, lat, lng, ts, sig }
	} catch (err) {
		if (err instanceof GeocodingNotFoundError) {
			return { ok: false, code: 'NOT_FOUND' }
		}
		Sentry.captureException(err)
		return { ok: false, code: 'UNAVAILABLE' }
	}
}

function buildQuery(input: GeocodingInput): string {
	return [input.address, input.city, input.state, input.zip]
		.filter(Boolean)
		.join(', ')
}

/**
 * Geocode an address using Nominatim (base URL from `NOMINATIM_URL`).
 * Adds a Sentry breadcrumb and span around each call.
 *
 * @throws {GeocodingNotFoundError} when Nominatim returns no results
 * @throws {GeocodingNetworkError} on non-2xx, fetch rejection, or non-JSON
 * @throws {GeocodingResponseError} when the response shape is unexpected
 */
export async function fetchGeocode(
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
			const url = new URL(
				`${serverEnv.NOMINATIM_URL}/search?${QUERY_PARAMS}&email=help@pickmyfruit.com`
			)
			url.searchParams.append('q', query)

			let response: Response
			try {
				response = await fetch(url.toString(), {
					headers: { 'User-Agent': USER_AGENT },
				})
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
