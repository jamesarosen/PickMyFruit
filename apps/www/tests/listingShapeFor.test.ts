import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'
import { listingShapeFor, type ListingViewer } from '../src/data/listing'
import type { Listing } from '../src/data/schema.server'

const NAPA = { lat: 38.2975, lng: -122.2869 }

function makeListing(overrides: Partial<Listing> = {}): Listing {
	const h3Index = latLngToCell(NAPA.lat, NAPA.lng, 13)
	return {
		id: faker.number.int({ min: 1, max: 9999 }),
		name: `${faker.person.firstName()}'s fig tree`,
		type: 'fig',
		variety: null,
		status: 'available',
		quantity: 'abundant',
		harvestWindow: 'June-September',
		address: '123 Main St',
		city: 'Napa',
		state: 'CA',
		zip: '94558',
		country: 'US',
		lat: NAPA.lat,
		lng: NAPA.lng,
		h3Index,
		publicH3Index: null,
		userId: 'owner-1',
		notes: null,
		accessInstructions: 'Ring doorbell',
		addressReleasePolicy: 'on_owner_approval',
		acceptsDropOffs: false,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

const ANON: ListingViewer = { userId: null, emailVerified: false }
const UNVERIFIED: ListingViewer = { userId: 'visitor-1', emailVerified: false }
const VERIFIED: ListingViewer = { userId: 'visitor-1', emailVerified: true }
const OWNER: ListingViewer = { userId: 'owner-1', emailVerified: true }
const OWNER_UNVERIFIED: ListingViewer = {
	userId: 'owner-1',
	emailVerified: false,
}

describe('listingShapeFor', () => {
	describe('owner viewer always gets the private shape', () => {
		it.each([
			{
				name: 'on_owner_approval + verified owner',
				policy: 'on_owner_approval' as const,
				viewer: OWNER,
			},
			{
				name: 'on_verified_request + verified owner',
				policy: 'on_verified_request' as const,
				viewer: OWNER,
			},
			{
				name: 'on_owner_approval + unverified owner',
				policy: 'on_owner_approval' as const,
				viewer: OWNER_UNVERIFIED,
			},
			{
				name: 'on_verified_request + unverified owner',
				policy: 'on_verified_request' as const,
				viewer: OWNER_UNVERIFIED,
			},
		])('$name → PrivateListing', ({ policy, viewer }) => {
			const listing = makeListing({ addressReleasePolicy: policy })
			const shape = listingShapeFor(listing, viewer)!

			// PrivateListing carries every Listing field including userId, address, lat/lng.
			expect(shape).toHaveProperty('userId', listing.userId)
			expect(shape).toHaveProperty('address', listing.address)
			expect(shape).toHaveProperty(
				'accessInstructions',
				listing.accessInstructions
			)
			expect(shape).toHaveProperty('lat', listing.lat)
			expect(shape).toHaveProperty('lng', listing.lng)
			expect(shape).toHaveProperty('h3Index', listing.h3Index)
			expect(shape).not.toHaveProperty('approximateH3Index')
		})
	})

	describe('on_owner_approval (default): non-owners always get PublicListing', () => {
		it.each([
			{ name: 'anonymous', viewer: ANON },
			{ name: 'authenticated but unverified', viewer: UNVERIFIED },
			{ name: 'authenticated and verified', viewer: VERIFIED },
		])('$name → PublicListing', ({ viewer }) => {
			const listing = makeListing({ addressReleasePolicy: 'on_owner_approval' })
			const shape = listingShapeFor(listing, viewer)!

			expect(shape).not.toHaveProperty('userId')
			expect(shape).not.toHaveProperty('address')
			expect(shape).not.toHaveProperty('accessInstructions')
			expect(shape).not.toHaveProperty('lat')
			expect(shape).not.toHaveProperty('lng')
			expect(shape).not.toHaveProperty('h3Index')
			expect(shape).not.toHaveProperty('zip')
			expect(shape).toHaveProperty('approximateH3Index')
		})
	})

	describe('on_verified_request: only verified members get the address', () => {
		it('anonymous viewer → PublicListing (no address)', () => {
			const listing = makeListing({ addressReleasePolicy: 'on_verified_request' })
			const shape = listingShapeFor(listing, ANON)!

			expect(shape).not.toHaveProperty('address')
			expect(shape).toHaveProperty('approximateH3Index')
		})

		it('authenticated but unverified → PublicListing (no address)', () => {
			const listing = makeListing({ addressReleasePolicy: 'on_verified_request' })
			const shape = listingShapeFor(listing, UNVERIFIED)!

			expect(shape).not.toHaveProperty('address')
			expect(shape).toHaveProperty('approximateH3Index')
		})

		it('verified non-owner → VerifiedPublicListing (with address + precise pin)', () => {
			const listing = makeListing({
				addressReleasePolicy: 'on_verified_request',
				address: '777 Sunset Blvd',
				city: 'Napa',
				state: 'CA',
				zip: '94558',
				country: 'US',
				lat: 38.31,
				lng: -122.31,
			})
			const shape = listingShapeFor(listing, VERIFIED)!

			expect(shape).toHaveProperty('address', '777 Sunset Blvd')
			expect(shape).toHaveProperty('city', 'Napa')
			expect(shape).toHaveProperty('state', 'CA')
			expect(shape).toHaveProperty('zip', '94558')
			// Precise pin is released alongside the address so the map can swap
			// to an exact-location marker.
			expect(shape).toHaveProperty('lat', 38.31)
			expect(shape).toHaveProperty('lng', -122.31)
			// Still public — no owner-only fields leak.
			expect(shape).not.toHaveProperty('userId')
			expect(shape).not.toHaveProperty('accessInstructions')
			expect(shape).not.toHaveProperty('h3Index')
			expect(shape).toHaveProperty('approximateH3Index')
		})
	})

	it('default policy preserves the pre-existing public shape', () => {
		// Listings created before this migration get the default
		// `on_owner_approval`, which must continue to gate the address behind
		// the inquiry flow for every non-owner — including verified members.
		const listing = makeListing()
		expect(listing.addressReleasePolicy).toBe('on_owner_approval')

		const shape = listingShapeFor(listing, VERIFIED)!
		expect(shape).not.toHaveProperty('address')
	})

	it('returns null when the h3 index is invalid (for non-owner)', () => {
		const listing = makeListing({ h3Index: 'not-a-real-h3' })
		const shape = listingShapeFor(listing, ANON)
		expect(shape).toBeNull()
	})

	describe('community produce stand — drop-off fields and gated steward name', () => {
		function makeStand(overrides: Partial<Listing> = {}): Listing {
			return makeListing({
				type: 'produce-stand',
				acceptsDropOffs: true,
				addressReleasePolicy: 'on_verified_request',
				...overrides,
			})
		}

		it('verified viewer sees acceptsDropOffs, dropOffGuidance, and stewardName', () => {
			const stand = makeStand()
			const shape = listingShapeFor(stand, VERIFIED, [], undefined, 'Pat Steward')!

			expect(shape).toHaveProperty('acceptsDropOffs', true)
			expect(shape).toHaveProperty('dropOffGuidance')
			expect((shape as { dropOffGuidance?: string }).dropOffGuidance).toMatch(
				/raw, whole, uncut/i
			)
			expect(shape).toHaveProperty('stewardName', 'Pat Steward')
		})

		it('stewardName is absent from the Public shape (anonymous viewer)', () => {
			const stand = makeStand()
			const shape = listingShapeFor(stand, ANON, [], undefined, 'Pat Steward')!

			// Security boundary: the steward's name must never reach an
			// unauthorized payload — this is a data-shape guarantee, not CSS.
			expect(shape).not.toHaveProperty('stewardName')
			expect(shape).not.toHaveProperty('address')
			// type / acceptsDropOffs are public so the stand is discoverable as one.
			expect(shape).toHaveProperty('type', 'produce-stand')
			expect(shape).toHaveProperty('acceptsDropOffs', true)
		})

		it('stewardName is absent for an unverified member', () => {
			const stand = makeStand()
			const shape = listingShapeFor(
				stand,
				UNVERIFIED,
				[],
				undefined,
				'Pat Steward'
			)!
			expect(shape).not.toHaveProperty('stewardName')
		})

		it('owner sees their own stewardName when supplied', () => {
			const stand = makeStand()
			const shape = listingShapeFor(stand, OWNER, [], undefined, 'Pat Steward')!
			expect(shape).toHaveProperty('stewardName', 'Pat Steward')
		})

		it('omits dropOffGuidance for a take-only stand', () => {
			const stand = makeStand({ acceptsDropOffs: false })
			const shape = listingShapeFor(stand, VERIFIED, [], undefined, 'Pat Steward')!
			expect(shape).not.toHaveProperty('dropOffGuidance')
			expect(shape).toHaveProperty('acceptsDropOffs', false)
		})
	})
})
