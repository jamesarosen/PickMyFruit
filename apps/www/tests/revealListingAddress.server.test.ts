import { beforeEach, describe, expect, it, vi } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'
import type { Listing } from '../src/data/schema.server'

const mockGetSession = vi.fn()
const mockGetListingWithOwner = vi.fn()
const mockGetPhotosForListing = vi.fn()
const mockRecordAddressReveal = vi.fn()
const mockMetricsCount = vi.fn()
const mockAddBreadcrumb = vi.fn()
const mockCaptureMessage = vi.fn()
const mockCaptureException = vi.fn()
const mockWithScope = vi.fn(
	(cb: (scope: { setFingerprint: () => void }) => void) => {
		cb({ setFingerprint: () => {} })
	}
)
const mockLoggerInfo = vi.fn()

vi.mock('../src/lib/auth.server', () => ({
	auth: { api: { getSession: mockGetSession } },
}))

vi.mock('../src/data/queries.server', () => ({
	getListingWithOwner: (...args: unknown[]) => mockGetListingWithOwner(...args),
	getPhotosForListing: (...args: unknown[]) => mockGetPhotosForListing(...args),
	recordAddressReveal: (...args: unknown[]) => mockRecordAddressReveal(...args),
}))

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: (...args: unknown[]) => mockCaptureException(...args),
		captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
		addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
		withScope: (cb: unknown) => mockWithScope(cb as never),
		metrics: { count: (...args: unknown[]) => mockMetricsCount(...args) },
		// startSpan passes through synchronously; not used by the handler itself
		// but imported by sibling fns in the same module — keep a no-op stub.
		startSpan: (_opts: unknown, cb: (span: unknown) => unknown) =>
			cb({ setAttribute: () => {} }),
	},
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: {
		info: (...args: unknown[]) => mockLoggerInfo(...args),
	},
}))

vi.mock('@tanstack/solid-start/server', () => ({
	getRequestHeaders: () => ({}),
}))

const { revealListingAddress } = await import('../src/api/listings')

const NAPA = { lat: 38.2975, lng: -122.2869 }

function makeListing(overrides: Partial<Listing> = {}): Listing {
	const h3Index = latLngToCell(NAPA.lat, NAPA.lng, 13)
	return {
		id: faker.number.int({ min: 1, max: 9999 }),
		name: 'A fig tree',
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
		userId: 'owner-1',
		notes: null,
		accessInstructions: null,
		addressReleasePolicy: 'on_verified_request',
		acceptsDropOffs: false,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

/** Wires getListingWithOwner to return the listing plus a default owner. */
function resolveListing(
	listing: Listing,
	owner: { id: string; name: string; email: string } = {
		id: listing.userId,
		name: 'Pat Owner',
		email: 'owner@example.com',
	}
) {
	mockGetListingWithOwner.mockResolvedValue({ listing, owner })
}

describe('revealListingAddress', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetPhotosForListing.mockResolvedValue([])
		mockRecordAddressReveal.mockResolvedValue({
			id: 1,
			userId: 'visitor-1',
			listingId: 1,
			createdAt: new Date(),
		})
	})

	it('gates an unauthenticated viewer without writing a reveal row', async () => {
		const listing = makeListing()
		mockGetSession.mockResolvedValue(null)
		resolveListing(listing)

		const result = await revealListingAddress({ data: listing.id })

		expect(result).toEqual({ tag: 'gated', reason: 'unauthenticated' })
		expect(mockRecordAddressReveal).not.toHaveBeenCalled()
		expect(mockMetricsCount).toHaveBeenCalledWith(
			'listing.address.reveal.click',
			1,
			{ attributes: { policy: 'on_verified_request' } }
		)
		expect(mockMetricsCount).toHaveBeenCalledWith(
			'listing.address.reveal.gated',
			1
		)
		expect(mockMetricsCount).not.toHaveBeenCalledWith(
			'listing.address.revealed',
			expect.anything(),
			expect.anything()
		)
	})

	it('gates an authenticated but unverified viewer without writing a reveal row', async () => {
		const listing = makeListing()
		mockGetSession.mockResolvedValue({
			user: { id: 'visitor-1', emailVerified: false },
		})
		resolveListing(listing)

		const result = await revealListingAddress({ data: listing.id })

		expect(result).toEqual({ tag: 'gated', reason: 'email_unverified' })
		expect(mockRecordAddressReveal).not.toHaveBeenCalled()
		expect(mockMetricsCount).toHaveBeenCalledWith(
			'listing.address.reveal.gated',
			1
		)
	})

	it('releases the address and writes a reveal row for a verified non-owner', async () => {
		const listing = makeListing({
			address: '777 Sunset Blvd',
			city: 'Napa',
			state: 'CA',
			zip: '94558',
			country: 'US',
			lat: 38.31,
			lng: -122.31,
		})
		mockGetSession.mockResolvedValue({
			user: { id: 'visitor-1', emailVerified: true },
		})
		resolveListing(listing)

		const result = await revealListingAddress({ data: listing.id })

		expect(result.tag).toBe('revealed')
		if (result.tag !== 'revealed') return
		expect(result.listing.address).toBe('777 Sunset Blvd')
		expect(result.listing.city).toBe('Napa')
		expect(result.listing.state).toBe('CA')
		expect(result.listing.zip).toBe('94558')
		expect(result.listing.lat).toBe(38.31)
		expect(result.listing.lng).toBe(-122.31)
		expect(result.listing).toHaveProperty('approximateH3Index')
		expect(result.listing).not.toHaveProperty('userId')

		expect(mockRecordAddressReveal).toHaveBeenCalledWith('visitor-1', listing.id)
		expect(mockMetricsCount).toHaveBeenCalledWith('listing.address.revealed', 1, {
			attributes: { policy: 'on_verified_request' },
		})
		expect(mockLoggerInfo).toHaveBeenCalledWith(
			expect.objectContaining({
				listingId: listing.id,
				userId: 'visitor-1',
				policy: 'on_verified_request',
				verified: true,
				wroteEvent: true,
			}),
			expect.any(String)
		)
	})

	it('records every reveal — repeats are not deduplicated', async () => {
		const listing = makeListing()
		mockGetSession.mockResolvedValue({
			user: { id: 'visitor-1', emailVerified: true },
		})
		resolveListing(listing)

		await revealListingAddress({ data: listing.id })
		await revealListingAddress({ data: listing.id })
		await revealListingAddress({ data: listing.id })

		expect(mockRecordAddressReveal).toHaveBeenCalledTimes(3)
	})

	it('skips the reveal-row write for the owning user but still returns the address', async () => {
		const listing = makeListing({ userId: 'owner-1' })
		mockGetSession.mockResolvedValue({
			user: { id: 'owner-1', emailVerified: true },
		})
		resolveListing(listing)

		const result = await revealListingAddress({ data: listing.id })

		expect(result.tag).toBe('revealed')
		expect(mockRecordAddressReveal).not.toHaveBeenCalled()
	})

	it('still releases the address when the reveal-row write fails, and captures the silent-failure signal', async () => {
		const listing = makeListing()
		mockGetSession.mockResolvedValue({
			user: { id: 'visitor-1', emailVerified: true },
		})
		resolveListing(listing)
		mockRecordAddressReveal.mockRejectedValue(new Error('disk full'))

		const result = await revealListingAddress({ data: listing.id })

		expect(result.tag).toBe('revealed')
		expect(mockCaptureException).toHaveBeenCalled()
		expect(mockCaptureMessage).toHaveBeenCalledWith(
			'Address reveal event write failed; address still released',
			expect.objectContaining({ level: 'error' })
		)
		expect(mockMetricsCount).toHaveBeenCalledWith('listing.address.revealed', 1, {
			attributes: { policy: 'on_verified_request' },
		})
	})

	it('rejects reveal attempts against on_owner_approval listings', async () => {
		const listing = makeListing({ addressReleasePolicy: 'on_owner_approval' })
		mockGetSession.mockResolvedValue({
			user: { id: 'visitor-1', emailVerified: true },
		})
		resolveListing(listing)

		await expect(revealListingAddress({ data: listing.id })).rejects.toThrow(
			/does not release its address automatically/i
		)
		expect(mockRecordAddressReveal).not.toHaveBeenCalled()
	})

	describe('produce stand', () => {
		it('surfaces stewardName and dropOffGuidance for a verified stand viewer', async () => {
			const listing = makeListing({
				type: 'produce-stand',
				acceptsDropOffs: true,
			})
			mockGetSession.mockResolvedValue({
				user: { id: 'visitor-1', emailVerified: true },
			})
			resolveListing(listing, {
				id: 'owner-1',
				name: 'Casey Steward',
				email: 'casey@example.com',
			})

			const result = await revealListingAddress({ data: listing.id })

			expect(result.tag).toBe('revealed')
			if (result.tag !== 'revealed') return
			expect(result.listing.stewardName).toBe('Casey Steward')
			expect(result.listing.dropOffGuidance).toMatch(/raw, whole, uncut/i)
		})

		it('omits dropOffGuidance for a stand that does not accept drop-offs', async () => {
			const listing = makeListing({
				type: 'produce-stand',
				acceptsDropOffs: false,
			})
			mockGetSession.mockResolvedValue({
				user: { id: 'visitor-1', emailVerified: true },
			})
			resolveListing(listing)

			const result = await revealListingAddress({ data: listing.id })

			expect(result.tag).toBe('revealed')
			if (result.tag !== 'revealed') return
			expect(result.listing.dropOffGuidance).toBeUndefined()
		})
	})
})
