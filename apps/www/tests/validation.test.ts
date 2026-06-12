import { describe, it, expect } from 'vitest'
import {
	ListingStatus,
	profileNameSchema,
	updateListingSchema,
	listingFormSchema,
} from '../src/lib/validation'

const baseForm = {
	type: 'apple',
	harvestWindow: 'September',
	address: '1 Main St',
	city: 'Napa',
	state: 'CA',
}

describe('listingFormSchema — produce-stand preset', () => {
	it('parses an ordinary listing without requiring a ToS acknowledgment', () => {
		const data = listingFormSchema.parse(baseForm)
		expect(data.acceptsDropOffs).toBe(false)
	})

	it('does not lock the address policy for a produce stand (orthogonal)', () => {
		const data = listingFormSchema.parse({
			...baseForm,
			type: 'produce-stand',
			addressReleasePolicy: 'on_owner_approval',
			acceptsDropOffs: false,
		})
		expect(data.addressReleasePolicy).toBe('on_owner_approval')
	})

	it('requires a ToS acknowledgment when a stand accepts drop-offs', () => {
		const result = listingFormSchema.safeParse({
			...baseForm,
			type: 'produce-stand',
			acceptsDropOffs: true,
			tosAcknowledged: false,
		})
		const issuePaths = result.success
			? []
			: result.error.issues.flatMap((i) => i.path)
		expect(result.success).toBe(false)
		expect(issuePaths).toContain('tosAcknowledged')
	})

	it('accepts a drop-off stand once the ToS is acknowledged', () => {
		const data = listingFormSchema.parse({
			...baseForm,
			type: 'produce-stand',
			acceptsDropOffs: true,
			tosAcknowledged: true,
		})
		expect(data.acceptsDropOffs).toBe(true)
	})
})

describe('listingFormSchema — international addresses', () => {
	it('accepts the legacy US shape and defaults the country to US', () => {
		const data = listingFormSchema.parse({ ...baseForm, zip: '94558' })
		expect(data.state).toBe('CA')
		expect(data.zip).toBe('94558')
		expect(data.country).toBe('US')
	})

	it.each([
		[
			'a French address',
			{ city: 'Paris', state: 'Île-de-France', zip: '75002', country: 'FR' },
		],
		[
			'a UK address with an alphanumeric postcode',
			{ city: 'London', state: undefined, zip: 'EC1A 1BB', country: 'GB' },
		],
		[
			'an address with no region line',
			{ city: 'Singapore', state: '', zip: '049145', country: 'SG' },
		],
		[
			'a full region name instead of a 2-letter abbreviation',
			{ state: 'California', country: 'US' },
		],
	])('accepts %s', (_, fields) => {
		const result = listingFormSchema.safeParse({ ...baseForm, ...fields })
		expect(result.success).toBe(true)
	})

	it('treats an empty region line as absent', () => {
		const data = listingFormSchema.parse({
			...baseForm,
			state: '',
			country: 'FR',
		})
		expect(data.state).toBeUndefined()
	})

	it('uppercases the country code', () => {
		const data = listingFormSchema.parse({ ...baseForm, country: 'fr' })
		expect(data.country).toBe('FR')
	})

	it.each([
		['a 3-letter country code', 'FRA'],
		['digits', '12'],
		['a country name', 'France'],
	])('rejects %s as a country', (_, country) => {
		const result = listingFormSchema.safeParse({ ...baseForm, country })
		expect(result.success).toBe(false)
	})

	it('rejects postal codes over 20 characters', () => {
		const result = listingFormSchema.safeParse({
			...baseForm,
			zip: '1'.repeat(21),
		})
		expect(result.success).toBe(false)
	})

	it('rejects region lines over 100 characters', () => {
		const result = listingFormSchema.safeParse({
			...baseForm,
			state: 'a'.repeat(101),
		})
		expect(result.success).toBe(false)
	})
})

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
