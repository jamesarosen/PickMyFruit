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

/**
 * Signs a subscription unsubscribe link. Unlike signUrl, these links do not
 * expire — an unsubscribe is low-risk and reversible, and expiring links in
 * weekly notification emails would make them stop working before the next batch.
 */
export function signUnsubscribeUrl(
	subscriptionId: number,
	userId: string
): string {
	const message = `unsubscribe:${subscriptionId}:${userId}`
	return createHmac('sha256', serverEnv.HMAC_SECRET)
		.update(message)
		.digest('hex')
}

/** Verifies an unsubscribe link signature. */
export function verifyUnsubscribeSignature(
	subscriptionId: number,
	userId: string,
	sig: string
): boolean {
	const expected = signUnsubscribeUrl(subscriptionId, userId)
	if (sig.length !== expected.length) {
		return false
	}
	return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

/** Builds a signed one-click unsubscribe URL for notification emails. */
export function buildUnsubscribeUrl(
	baseUrl: string,
	subscriptionId: number,
	userId: string
): string {
	const sig = signUnsubscribeUrl(subscriptionId, userId)
	return `${baseUrl}/api/notifications/${subscriptionId}/unsubscribe?userId=${encodeURIComponent(userId)}&sig=${sig}`
}
