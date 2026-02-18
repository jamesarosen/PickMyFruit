import { describe, it, expect, vi } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell, cellToParent, getResolution } from 'h3-js'
import { toPublicListing } from '../src/data/public-listing'
import type { Listing } from '../src/data/schema'

const NAPA = { lat: 38.2975, lng: -122.2869 }

function makeListing(overrides: Partial<Listing> = {}): Listing {
	const h3Index = latLngToCell(NAPA.lat, NAPA.lng, 13)
	return {
		id: faker.number.int({ min: 1, max: 9999 }),
		name: `${faker.person.firstName()}'s fig tree`,
		type: 'fig',
		variety: 'Black Mission',
		status: 'available',
		quantity: 'abundant',
		harvestWindow: 'June-September',
		address: faker.location.streetAddress(),
		city: 'Napa',
		state: 'CA',
		zip: '94558',
		lat: NAPA.lat,
		lng: NAPA.lng,
		h3Index,
		userId: faker.string.uuid(),
		notes: null,
		accessInstructions: 'Ring doorbell',
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

/** The exact set of keys a PublicListing should have, sorted. */
const EXPECTED_PUBLIC_KEYS = [
	'approximateH3Index',
	'city',
	'createdAt',
	'harvestWindow',
	'id',
	'name',
	'notes',
	'quantity',
	'state',
	'status',
	'type',
	'updatedAt',
	'userId',
	'variety',
].sort()

describe('toPublicListing', () => {
	it('strips all sensitive fields', () => {
		const listing = makeListing()
		const result = toPublicListing(listing)!

		expect(result).not.toHaveProperty('address')
		expect(result).not.toHaveProperty('accessInstructions')
		expect(result).not.toHaveProperty('deletedAt')
		expect(result).not.toHaveProperty('lat')
		expect(result).not.toHaveProperty('lng')
		expect(result).not.toHaveProperty('h3Index')
		expect(result).not.toHaveProperty('zip')
	})

	it('output keys match expected public fields exactly', () => {
		const listing = makeListing()
		const result = toPublicListing(listing)!

		expect(Object.keys(result).sort()).toEqual(EXPECTED_PUBLIC_KEYS)
	})

	it('coarsens h3Index from resolution 13 to 7', () => {
		const listing = makeListing()
		const result = toPublicListing(listing)!

		expect(getResolution(result.approximateH3Index)).toBe(7)
		expect(result.approximateH3Index).toBe(cellToParent(listing.h3Index, 7))
	})

	it('preserves safe fields unchanged', () => {
		const listing = makeListing({
			id: 42,
			name: 'Test Tree',
			type: 'lemon',
			variety: 'Meyer',
			city: 'Napa',
			state: 'CA',
			notes: 'Pick anytime',
		})
		const result = toPublicListing(listing)!

		expect(result.id).toBe(42)
		expect(result.name).toBe('Test Tree')
		expect(result.type).toBe('lemon')
		expect(result.variety).toBe('Meyer')
		expect(result.city).toBe('Napa')
		expect(result.state).toBe('CA')
		expect(result.notes).toBe('Pick anytime')
	})

	it('returns null and calls onError for invalid h3Index', () => {
		const listing = makeListing({ h3Index: 'not-a-valid-h3' })
		const onError = vi.fn()

		const result = toPublicListing(listing, onError)

		expect(result).toBeNull()
		expect(onError).toHaveBeenCalledWith(listing.id, expect.any(Error))
	})

	it('returns null without throwing when onError is omitted', () => {
		const listing = makeListing({ h3Index: 'not-a-valid-h3' })

		const result = toPublicListing(listing)

		expect(result).toBeNull()
	})
})
