import { randomUUID } from 'crypto'
import { faker } from '@faker-js/faker'
import { describe, it, expect } from 'vitest'
import {
	signUrl,
	verifySignature,
	buildUnavailableUrl,
	SIGNATURE_MAX_AGE_MS,
} from '../src/lib/hmac'

describe('signUrl', () => {
	it('returns nonce, timestamp, and signature', () => {
		const result = signUrl(faker.number.int({ min: 1, max: 9999 }))
		expect(result.nonce).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		)
		expect(result.ts).toBeGreaterThan(0)
		expect(result.sig).toMatch(/^[0-9a-f]{64}$/)
	})

	it('generates unique nonces per call', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const a = signUrl(id)
		const b = signUrl(id)
		expect(a.nonce).not.toBe(b.nonce)
	})
})

describe('verifySignature', () => {
	it('accepts a valid, fresh signature', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		expect(verifySignature(id, nonce, ts, sig)).toBe(true)
	})

	it('rejects a tampered listing ID', () => {
		const id = faker.number.int({ min: 1, max: 4999 })
		const { nonce, ts, sig } = signUrl(id)
		expect(verifySignature(id + 5000, nonce, ts, sig)).toBe(false)
	})

	it('rejects a tampered nonce', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		const tampered = randomUUID()
		expect(tampered).not.toBe(nonce)
		expect(verifySignature(id, tampered, ts, sig)).toBe(false)
	})

	it('rejects a tampered timestamp', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		expect(verifySignature(id, nonce, ts + 1, sig)).toBe(false)
	})

	it('rejects a tampered signature', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts } = signUrl(id)
		const other = signUrl(id + 1)
		expect(verifySignature(id, nonce, ts, other.sig)).toBe(false)
	})

	it('rejects a signature older than max age', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		const afterExpiry = ts + SIGNATURE_MAX_AGE_MS + 1
		expect(verifySignature(id, nonce, ts, sig, afterExpiry)).toBe(false)
	})

	it('accepts a signature just under max age', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		const justUnderMaxAge = ts + SIGNATURE_MAX_AGE_MS - 1000
		expect(verifySignature(id, nonce, ts, sig, justUnderMaxAge)).toBe(true)
	})

	it('rejects a timestamp from the future', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const { nonce, ts, sig } = signUrl(id)
		const beforeSigning = ts - 1000
		expect(verifySignature(id, nonce, ts, sig, beforeSigning)).toBe(false)
	})
})

describe('buildUnavailableUrl', () => {
	it('includes listing ID, nonce, ts, and sig in the URL', () => {
		const id = faker.number.int({ min: 1, max: 9999 })
		const url = buildUnavailableUrl('https://example.com', id)
		const parsed = new URL(url)
		expect(parsed.pathname).toBe(`/api/listings/${id}/unavailable`)
		expect(parsed.searchParams.get('nonce')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/)
		expect(parsed.searchParams.get('ts')).toMatch(/^\d+$/)
		expect(parsed.searchParams.get('sig')).toMatch(/^[0-9a-f]{64}$/)
	})
})
