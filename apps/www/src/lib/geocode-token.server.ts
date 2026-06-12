import { signMessage, verifyMessageSignature } from './hmac.server'
import type { GeocodingInput } from './geocoding'

/**
 * Geocode tokens must outlive the unauthenticated listing flow: the form
 * geocodes before magic-link auth and auto-submits after the user returns
 * from their inbox, which can be much later.
 */
export const GEOCODE_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000

const DOMAIN = 'geocode'

/** Server-issued proof that a (address, lat, lng) tuple came from our geocoder. */
export interface GeocodeToken {
	ts: number
	sig: string
}

// The canonical form must be identical at sign and verify time: trimmed
// fields, absent zip ≡ empty string, and JSON-array encoding so user-supplied
// separators cannot create ambiguous messages.
function canonicalMessage(
	input: GeocodingInput,
	lat: number,
	lng: number,
	ts: number
): string {
	return JSON.stringify([
		input.address.trim(),
		input.city.trim(),
		input.state.trim(),
		(input.zip ?? '').trim(),
		lat,
		lng,
		ts,
	])
}

/** Signs geocoder output so the listing-create endpoint can verify provenance. */
export function signGeocodeResult(
	input: GeocodingInput,
	lat: number,
	lng: number,
	now: number = Date.now()
): GeocodeToken {
	return {
		ts: now,
		sig: signMessage(DOMAIN, canonicalMessage(input, lat, lng, now)),
	}
}

/** Verifies that (address fields, lat, lng) were signed by signGeocodeResult and have not expired. */
export function verifyGeocodeToken(
	input: GeocodingInput,
	lat: number,
	lng: number,
	token: GeocodeToken,
	now: number = Date.now()
): boolean {
	const age = now - token.ts
	if (age < 0 || age > GEOCODE_TOKEN_MAX_AGE_MS) {
		return false
	}
	return verifyMessageSignature(
		DOMAIN,
		canonicalMessage(input, lat, lng, token.ts),
		token.sig
	)
}
