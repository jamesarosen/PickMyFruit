import { describe, it, expect } from 'vitest'
import {
	ListingStatus,
	profileNameSchema,
	updateListingSchema,
} from '../src/lib/validation'

describe('profileNameSchema', () => {
	it.each([
		['empty string (skip path)', ''],
		['normal name', 'Jane Gleaner'],
		['exactly 100 chars', 'a'.repeat(100)],
		['whitespace only', '   '],
	])('accepts %s', (_, name) => {
		expect(profileNameSchema.safeParse(name).success).toBe(true)
	})

	it('rejects names over 100 characters', () => {
		const result = profileNameSchema.safeParse('a'.repeat(101))
		expect(result.success).toBe(false)
		expect(result.error?.issues[0]?.message).toBe(
			'Name must be 100 characters or fewer'
		)
	})
})

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

describe('updateListingSchema', () => {
	const base = { id: 1, clientUpdatedAt: 1700000000 }

	it('accepts a valid status update', () => {
		const result = updateListingSchema.safeParse({ ...base, status: 'available' })
		expect(result.success).toBe(true)
	})

	it('accepts a name update', () => {
		const result = updateListingSchema.safeParse({ ...base, name: 'Lemon Tree' })
		expect(result.success).toBe(true)
	})

	it('accepts multiple fields at once', () => {
		const result = updateListingSchema.safeParse({
			...base,
			name: 'Apple',
			harvestWindow: 'September',
			notes: null,
		})
		expect(result.success).toBe(true)
	})

	it('rejects an invalid status value', () => {
		const result = updateListingSchema.safeParse({ ...base, status: 'claimed' })
		expect(result.success).toBe(false)
	})

	it('rejects when no data field is provided (only id + clientUpdatedAt)', () => {
		const result = updateListingSchema.safeParse(base)
		expect(result.success).toBe(false)
	})

	it('rejects missing clientUpdatedAt', () => {
		const result = updateListingSchema.safeParse({ id: 1, name: 'Test' })
		expect(result.success).toBe(false)
	})
})
