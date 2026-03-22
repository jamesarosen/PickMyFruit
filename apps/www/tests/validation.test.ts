import { describe, it, expect } from 'vitest'
import {
	ListingStatus,
	profileNameSchema,
	updateListingStatusSchema,
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
