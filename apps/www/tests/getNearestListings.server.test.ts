/**
 * Privacy-focused tests for getNearestListings: ordering must resolve only to
 * res-8 granularity (quantized center + cell-center distance), so sweeping the
 * query point can never triangulate a listing finer than its public cell.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { latLngToCell } from 'h3-js'

vi.mock('../src/lib/storage.server', () => ({
	storage: { publicUrl: (path: string) => `https://cdn.example.com/${path}` },
}))

let listingRows: Record<string, unknown>[] = []

// The main query awaits at `.where()`; the photo lookup awaits at `.orderBy()`.
// Branch on whether `select()` was given an explicit projection (photos do).
vi.mock('../src/data/db.server', () => ({
	db: {
		select: (...args: unknown[]) => {
			const isPhotoLookup = args.length > 0
			return {
				from: () => ({
					where: () =>
						isPhotoLookup
							? { orderBy: () => Promise.resolve([]) }
							: Promise.resolve(listingRows),
				}),
			}
		},
	},
}))

const { getNearestListings } = await import('../src/data/queries.server')

const A = { lat: 38.3, lng: -122.3 } // central Napa
const B = { lat: 38.291, lng: -122.46 } // Sonoma — a different res-8 cell

function row(id: number, point: { lat: number; lng: number }) {
	return {
		id,
		name: `listing ${id}`,
		type: 'fig',
		variety: null,
		status: 'available',
		quantity: null,
		harvestWindow: null,
		address: '1 Main St',
		city: id === 1 ? 'Napa' : 'Sonoma',
		state: 'CA',
		zip: null,
		country: 'US',
		lat: point.lat,
		lng: point.lng,
		h3Index: latLngToCell(point.lat, point.lng, 13),
		publicH3Index: latLngToCell(point.lat, point.lng, 8),
		userId: 'u1',
		acceptsDropOffs: false,
		notes: null,
		accessInstructions: null,
		addressReleasePolicy: 'on_owner_approval',
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}

describe('getNearestListings', () => {
	beforeEach(() => {
		listingRows = [row(1, A), row(2, B)]
	})

	it('orders by proximity to the query center', async () => {
		const nearA = await getNearestListings(A.lat, A.lng)
		expect(nearA.map((l) => l.id)).toEqual([1, 2])

		const nearB = await getNearestListings(B.lat, B.lng)
		expect(nearB.map((l) => l.id)).toEqual([2, 1])
	})

	it('does not expose raw coordinates', async () => {
		const [first] = await getNearestListings(A.lat, A.lng)
		expect(first).not.toHaveProperty('lat')
		expect(first).not.toHaveProperty('lng')
		expect(first).not.toHaveProperty('h3Index')
		expect(first).toHaveProperty('approximateH3Index')
	})

	it('order is stable under sub-res-8 movement of the center (no triangulation)', async () => {
		// Nudge the center by metres, staying inside the same res-8 cell.
		expect(latLngToCell(A.lat, A.lng, 8)).toBe(
			latLngToCell(A.lat + 0.0003, A.lng - 0.0003, 8)
		)
		const base = await getNearestListings(A.lat, A.lng)
		const nudged = await getNearestListings(A.lat + 0.0003, A.lng - 0.0003)
		expect(nudged.map((l) => l.id)).toEqual(base.map((l) => l.id))
	})
})
