import { describe, it, expect } from 'vitest'
import { latLngToCell, cellToParent } from 'h3-js'
import {
	ListingStatus,
	updateListingStatusSchema,
	createSubscriptionSchema,
} from '../src/lib/validation'

const NAPA_LAT = 38.2966
const NAPA_LNG = -122.2893
const validBase = {
	locationName: 'Napa coverage',
	throttlePeriod: 'daily' as const,
	centerH3: latLngToCell(NAPA_LAT, NAPA_LNG, 8),
	resolution: 8,
	ringSize: 0,
}

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

describe('createSubscriptionSchema', () => {
	it('accepts a valid subscription', () => {
		const result = createSubscriptionSchema.safeParse(validBase)
		expect(result.success).toBe(true)
	})

	it('rejects a garbage centerH3 string', () => {
		const result = createSubscriptionSchema.safeParse({
			...validBase,
			centerH3: 'not-a-valid-cell',
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path.join('.'))
			expect(paths).toContain('centerH3')
		}
	})

	it('rejects when centerH3 resolution does not match resolution field', () => {
		// res-7 cell paired with resolution: 8
		const res7Cell = cellToParent(latLngToCell(NAPA_LAT, NAPA_LNG, 8), 7)
		const result = createSubscriptionSchema.safeParse({
			...validBase,
			centerH3: res7Cell,
			resolution: 8,
		})
		expect(result.success).toBe(false)
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path.join('.'))
			expect(paths).toContain('centerH3')
		}
	})

	it('accepts a res-7 cell when resolution is 7', () => {
		const res7Cell = cellToParent(latLngToCell(NAPA_LAT, NAPA_LNG, 8), 7)
		const result = createSubscriptionSchema.safeParse({
			...validBase,
			centerH3: res7Cell,
			resolution: 7,
		})
		expect(result.success).toBe(true)
	})

	it('rejects an empty centerH3', () => {
		const result = createSubscriptionSchema.safeParse({
			...validBase,
			centerH3: '',
		})
		expect(result.success).toBe(false)
	})
})
