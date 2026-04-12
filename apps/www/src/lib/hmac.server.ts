import { createHmac, timingSafeEqual, randomUUID } from 'crypto'
import { serverEnv } from './env.server'

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
	const sig = createHmac('sha256', serverEnv.HMAC_SECRET)
		.update(message)
		.digest('hex')
	return { nonce, ts, sig }
}

/** Verifies an HMAC signature, rejecting expired or tampered URLs. */
export function verifySignature(
	listingId: number,
	query: { nonce: string; ts: number; sig: string },
	now: number = Date.now()
): boolean {
	const { nonce, ts, sig } = query
	const age = now - ts
	if (age < 0 || age > SIGNATURE_MAX_AGE_MS) {
		return false
	}
	const message = `${listingId}:${nonce}:${ts}`
	const expected = createHmac('sha256', serverEnv.HMAC_SECRET)
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

/** Signs a subscription ID for use in one-click unsubscribe URLs. No expiry. */
export function signUnsubscribeUrl(
	baseUrl: string,
	subscriptionId: number
): string {
	const message = `unsubscribe:${subscriptionId}`
	const sig = createHmac('sha256', serverEnv.HMAC_SECRET)
		.update(message)
		.digest('hex')
	return `${baseUrl}/api/notifications/${subscriptionId}/unsubscribe?sig=${sig}`
}

/** Verifies a subscription unsubscribe HMAC signature. */
export function verifyUnsubscribeSignature(
	subscriptionId: number,
	sig: string
): boolean {
	const message = `unsubscribe:${subscriptionId}`
	const expected = createHmac('sha256', serverEnv.HMAC_SECRET)
		.update(message)
		.digest('hex')
	if (sig.length !== expected.length) {
		return false
	}
	return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}
