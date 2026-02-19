import { createHmac, timingSafeEqual, randomUUID } from 'crypto'

const secret = process.env.HMAC_SECRET
if (!secret && process.env.NODE_ENV === 'production') {
	throw new Error('HMAC_SECRET must be set in production')
}
if (!secret) {
	console.warn('[hmac] HMAC_SECRET not set, using insecure development default')
}
const HMAC_SECRET = secret || 'dev-secret-change-in-prod'

/** Signed URLs expire after 7 days. */
export const SIGNATURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Signs a listing ID with a nonce and timestamp for URL construction. */
export function signUrl(listingId: number): {
	nonce: string
	ts: number
	sig: string
} {
	const nonce = randomUUID()
	const ts = Date.now()
	const message = `${listingId}:${nonce}:${ts}`
	const sig = createHmac('sha256', HMAC_SECRET).update(message).digest('hex')
	return { nonce, ts, sig }
}

/** Verifies an HMAC signature, rejecting expired or tampered URLs. */
export function verifySignature(
	listingId: number,
	nonce: string,
	ts: number,
	sig: string,
	now: number = Date.now()
): boolean {
	const age = now - ts
	if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
		return false
	}
	const message = `${listingId}:${nonce}:${ts}`
	const expected = createHmac('sha256', HMAC_SECRET)
		.update(message)
		.digest('hex')
	if (sig.length !== expected.length) {
		return false
	}
	return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

/** Builds a signed "mark unavailable" URL for email links. */
export function buildUnavailableUrl(
	baseUrl: string,
	listingId: number
): string {
	const { nonce, ts, sig } = signUrl(listingId)
	return `${baseUrl}/api/listings/${listingId}/unavailable?nonce=${nonce}&ts=${ts}&sig=${sig}`
}
