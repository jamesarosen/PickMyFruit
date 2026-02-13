import { createHmac, timingSafeEqual, randomUUID } from 'crypto'

const HMAC_SECRET = process.env.HMAC_SECRET || 'dev-secret-change-in-prod'

export function signUrl(listingId: number): { nonce: string; sig: string } {
	const nonce = randomUUID()
	const message = `${listingId}:${nonce}`
	const sig = createHmac('sha256', HMAC_SECRET).update(message).digest('hex')
	return { nonce, sig }
}

export function verifySignature(
	listingId: number,
	nonce: string,
	sig: string
): boolean {
	const message = `${listingId}:${nonce}`
	const expected = createHmac('sha256', HMAC_SECRET)
		.update(message)
		.digest('hex')
	// Timing-safe comparison
	if (sig.length !== expected.length) {
		return false
	}
	return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

export function buildUnavailableUrl(
	baseUrl: string,
	listingId: number
): string {
	const { nonce, sig } = signUrl(listingId)
	return `${baseUrl}/api/listings/${listingId}/unavailable?nonce=${nonce}&sig=${sig}`
}
