import { z } from 'zod'
import type { AddressFields } from '@/data/schema.server'
import { countryName } from '@/lib/format-location'
import type { LocationBias } from '@/lib/geolocation'
import { Sentry } from '@/lib/sentry'

/** A structured address suggestion with its coordinates. */
export interface AddressSuggestion {
	/** Human-readable line shown in the suggestion list. */
	label: string
	/** Street line, e.g. "12 Rue de la Paix". */
	address: string
	city: string
	state: string | null
	postcode: string | null
	/** ISO 3166-1 alpha-2, uppercase. */
	countryCode: string
	lat: number
	lng: number
}

/**
 * Any failure fetching or parsing suggestions. The UI treats all of these the
 * same way: show a notice and offer manual entry, never block the form.
 */
export class SuggestionsUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'SuggestionsUnavailableError'
	}
}

// Photon (photon.komoot.io) is OSM-based and built for search-as-you-type —
// Nominatim's usage policy forbids autocomplete, so it cannot power this.
// Like Nominatim in geocoding.ts, requests come directly from the browser.
// @see docs/0011-international-address-entry.md
const SUGGEST_URL = 'https://photon.komoot.io/api/?limit=5&lang=en'
// @see docs/0012-geolocation-location-bias.md
const REVERSE_URL = 'https://photon.komoot.io/reverse?limit=1&lang=en'

const photonFeatureSchema = z.object({
	geometry: z.object({
		coordinates: z.tuple([z.number(), z.number()]),
	}),
	properties: z
		.object({
			name: z.string().optional(),
			housenumber: z.string().optional(),
			street: z.string().optional(),
			city: z.string().optional(),
			district: z.string().optional(),
			county: z.string().optional(),
			state: z.string().optional(),
			postcode: z.string().optional(),
			country: z.string().optional(),
			countrycode: z.string().optional(),
		})
		.loose(),
})

const photonResponseSchema = z.object({
	features: z.array(z.unknown()),
})

type PhotonFeature = z.infer<typeof photonFeatureSchema>

/**
 * Maps a Photon feature to a suggestion, or null when it lacks the parts a
 * listing needs (street line/name, locality, country code).
 */
function toSuggestion(feature: PhotonFeature): AddressSuggestion | null {
	const p = feature.properties

	const streetLine =
		p.housenumber && p.street
			? `${p.housenumber} ${p.street}`
			: (p.street ?? p.name)
	if (!streetLine) return null

	// Locality fallback chain — `city` is NOT NULL in the schema, so a usable
	// suggestion must resolve to *some* locality, however coarse.
	const locality = p.city ?? p.district ?? p.county ?? p.state ?? p.country
	if (!locality) return null

	if (!p.countrycode) return null

	const [lng, lat] = feature.geometry.coordinates
	return {
		label: composeLabel([streetLine, locality, p.state, p.postcode, p.country]),
		address: streetLine,
		city: locality,
		state: p.state ?? null,
		postcode: p.postcode ?? null,
		countryCode: p.countrycode.toUpperCase(),
		lat,
		lng,
	}
}

function composeLabel(parts: Array<string | null | undefined>): string {
	const labelParts: string[] = []
	for (const part of parts) {
		if (part && !labelParts.includes(part)) labelParts.push(part)
	}
	return labelParts.join(', ')
}

/**
 * Rebuilds a suggestion from a listing's stored address fields, so a
 * pre-filled address (with its stored coordinates) behaves exactly like a
 * fresh selection — no new lookup needed.
 */
export function addressFieldsToSuggestion(
	fields: AddressFields
): AddressSuggestion {
	return {
		label: composeLabel([
			fields.address,
			fields.city,
			fields.state,
			fields.zip,
			countryName(fields.country),
		]),
		address: fields.address,
		city: fields.city,
		state: fields.state,
		postcode: fields.zip,
		countryCode: fields.country,
		lat: fields.lat,
		lng: fields.lng,
	}
}

/**
 * Fetches a Photon endpoint and maps its features to suggestions, skipping
 * any feature that lacks the parts a listing needs.
 *
 * @throws {SuggestionsUnavailableError} on network, HTTP, or response-shape
 * failures
 * @throws {DOMException} `AbortError` is re-thrown untouched so callers can
 * silently drop stale in-flight requests
 */
async function fetchPhotonSuggestions(
	url: URL,
	signal?: AbortSignal
): Promise<AddressSuggestion[]> {
	let response: Response
	try {
		response = await fetch(url.toString(), { signal })
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') throw err
		throw new SuggestionsUnavailableError(
			err instanceof Error ? err.message : 'Network error fetching suggestions'
		)
	}

	if (!response.ok) {
		Sentry.captureMessage('suggestions.request_failed', {
			level: 'warning',
			extra: { status: response.status },
		})
		throw new SuggestionsUnavailableError(
			`Suggestion request failed: ${response.status}`
		)
	}

	let json: unknown
	try {
		json = await response.json()
	} catch {
		throw new SuggestionsUnavailableError(
			'Suggestion response was not valid JSON'
		)
	}

	const parsed = photonResponseSchema.safeParse(json)
	if (!parsed.success) {
		const err = new SuggestionsUnavailableError(
			'Suggestion response did not match expected shape'
		)
		Sentry.captureException(err)
		throw err
	}

	const suggestions: AddressSuggestion[] = []
	for (const raw of parsed.data.features) {
		const feature = photonFeatureSchema.safeParse(raw)
		if (!feature.success) continue
		const suggestion = toSuggestion(feature.data)
		if (suggestion) suggestions.push(suggestion)
	}
	return suggestions
}

/**
 * Fetch address suggestions for a partial query from Photon, optionally
 * re-ranked toward a bias point (the results are biased, never filtered).
 *
 * Features that cannot be mapped to a usable suggestion are skipped, so the
 * result may be shorter than Photon's response (or empty).
 *
 * @throws {SuggestionsUnavailableError} on network, HTTP, or response-shape
 * failures
 * @throws {DOMException} `AbortError` is re-thrown untouched so callers can
 * silently drop stale in-flight requests
 */
export async function fetchAddressSuggestions(
	query: string,
	options: { signal?: AbortSignal; bias?: LocationBias } = {}
): Promise<AddressSuggestion[]> {
	// Unlike geocoding.ts this runs per keystroke, so only the length is
	// breadcrumbed — never the partial address itself (nor the bias point,
	// which may be the user's position). The SDK's own fetch breadcrumbs and
	// spans are scrubbed of these URLs' query strings in sentry.ts.
	Sentry.addBreadcrumb({
		category: 'address-suggestions',
		level: 'info',
		data: { queryLength: query.length },
	})

	return Sentry.startSpan(
		{ name: 'suggestions.photon', op: 'http.client' },
		async () => {
			const url = new URL(SUGGEST_URL)
			url.searchParams.append('q', query)
			if (options.bias) {
				url.searchParams.append('lat', String(options.bias.lat))
				url.searchParams.append('lon', String(options.bias.lng))
			}
			return fetchPhotonSuggestions(url, options.signal)
		}
	)
}

/**
 * Reverse-geocodes a position into a suggestion via Photon, or null when
 * Photon returns nothing usable for a listing address.
 *
 * @throws {SuggestionsUnavailableError} on network, HTTP, or response-shape
 * failures
 * @throws {DOMException} `AbortError` is re-thrown untouched so callers can
 * silently drop stale in-flight requests
 */
export async function fetchReverseGeocodedAddress(
	location: LocationBias,
	options: { signal?: AbortSignal } = {}
): Promise<AddressSuggestion | null> {
	return Sentry.startSpan(
		{ name: 'suggestions.photon.reverse', op: 'http.client' },
		async () => {
			const url = new URL(REVERSE_URL)
			url.searchParams.append('lat', String(location.lat))
			url.searchParams.append('lon', String(location.lng))
			const suggestions = await fetchPhotonSuggestions(url, options.signal)
			return suggestions[0] ?? null
		}
	)
}
