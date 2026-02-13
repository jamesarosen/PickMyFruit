import { describe, it, expect } from 'vitest'
import { ListingStatus, updateListingStatusSchema } from '../src/lib/validation'

describe('ListingStatus', () => {
	it.each([
		['available', 'available'],
		['unavailable', 'unavailable'],
		['private', 'private'],
	] as const)('has %s = "%s"', (key, value) => {
		expect(ListingStatus[key]).toBe(value)
	})

	it('has exactly three statuses', () => {
		expect(Object.keys(ListingStatus)).toHaveLength(3)
	})
})

describe('updateListingStatusSchema', () => {
	it.each([
		ListingStatus.available,
		ListingStatus.unavailable,
		ListingStatus.private,
	])('accepts valid status "%s"', (status) => {
		const result = updateListingStatusSchema.safeParse({ status })
		expect(result.success).toBe(true)
	})

	it('rejects invalid status value', () => {
		const result = updateListingStatusSchema.safeParse({ status: 'claimed' })
		expect(result.success).toBe(false)
	})

	it('rejects missing status field', () => {
		const result = updateListingStatusSchema.safeParse({})
		expect(result.success).toBe(false)
	})

	it('rejects empty string', () => {
		const result = updateListingStatusSchema.safeParse({ status: '' })
		expect(result.success).toBe(false)
	})
})
