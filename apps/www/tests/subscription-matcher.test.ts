import { describe, it, expect } from 'vitest'
import { latLngToCell, cellToParent, gridDisk } from 'h3-js'
import {
	getSubscriptionCells,
	listingMatchesSubscription,
	listingMatchesProduceFilter,
} from '../src/lib/subscription-matcher'

// Napa, CA — used as a consistent geographic anchor for tests
const NAPA_LAT = 38.2966234
const NAPA_LNG = -122.2893688

// Cells at the subscription resolutions used in these tests
const napaH3Res8 = latLngToCell(NAPA_LAT, NAPA_LNG, 8)
const napaH3Res7 = latLngToCell(NAPA_LAT, NAPA_LNG, 7)

// A distant cell far from Napa (Sacramento area)
const SAC_LAT = 38.5816
const SAC_LNG = -121.4944
const sacH3Res8 = latLngToCell(SAC_LAT, SAC_LNG, 8)

describe(getSubscriptionCells, () => {
	it('returns a Set containing the center cell', () => {
		const sub = { centerH3: napaH3Res8, ringSize: 0 }
		const cells = getSubscriptionCells(sub)
		expect(cells.has(napaH3Res8)).toBeTruthy()
	})

	it('returns more cells with ringSize=1 than ringSize=0', () => {
		const ring0 = getSubscriptionCells({ centerH3: napaH3Res8, ringSize: 0 })
		const ring1 = getSubscriptionCells({ centerH3: napaH3Res8, ringSize: 1 })
		// ring 0 = 1 cell; ring 1 = 7 cells (center + 6 neighbors)
		expect(ring1.size).toBeGreaterThan(ring0.size)
	})

	it('returns all cells from gridDisk', () => {
		const sub = { centerH3: napaH3Res8, ringSize: 2 }
		const cells = getSubscriptionCells(sub)
		const expected = new Set(gridDisk(napaH3Res8, 2))
		expect(cells).toEqual(expected)
	})

	it('returns empty Set for invalid H3 center', () => {
		const sub = { centerH3: 'not-a-valid-h3-cell', ringSize: 0 }
		const cells = getSubscriptionCells(sub)
		expect(cells.size).toBe(0)
	})
})

describe(listingMatchesSubscription, () => {
	it('returns true when listing cell is the center cell (ringSize=0, same resolution)', () => {
		const listing = { approximateH3Index: napaH3Res8 }
		const sub = { centerH3: napaH3Res8, resolution: 8, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeTruthy()
	})

	it('returns true when listing falls within a coarser subscription resolution', () => {
		// Subscription at res 7 covers a larger area; listing at res 8 is a child
		const listing = { approximateH3Index: napaH3Res8 }
		const sub = { centerH3: napaH3Res7, resolution: 7, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeTruthy()
	})

	it('returns true when listing falls within a ring-1 subscription', () => {
		// A neighbor of the center cell should be covered by ringSize=1
		const cells = gridDisk(napaH3Res8, 1)
		const neighborCell = cells.find((c) => c !== napaH3Res8)!
		const listing = { approximateH3Index: neighborCell }
		const sub = { centerH3: napaH3Res8, resolution: 8, ringSize: 1 }
		expect(listingMatchesSubscription(listing, sub)).toBeTruthy()
	})

	it('returns false when listing is outside the subscription area', () => {
		const listing = { approximateH3Index: sacH3Res8 }
		const sub = { centerH3: napaH3Res8, resolution: 8, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeFalsy()
	})

	it('returns false for an invalid listing H3 index', () => {
		const listing = { approximateH3Index: 'invalid-cell' }
		const sub = { centerH3: napaH3Res8, resolution: 8, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeFalsy()
	})

	it('returns false when subscription has invalid center H3', () => {
		const listing = { approximateH3Index: napaH3Res8 }
		const sub = { centerH3: 'bad-cell', resolution: 8, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeFalsy()
	})

	it('returns false when listing is a neighbor at ringSize=0', () => {
		const cells = gridDisk(napaH3Res8, 1)
		const neighborCell = cells.find((c) => c !== napaH3Res8)!
		const listing = { approximateH3Index: neighborCell }
		// ringSize=0 covers only the center cell
		const sub = { centerH3: napaH3Res8, resolution: 8, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeFalsy()
	})
})

describe(listingMatchesProduceFilter, () => {
	it('returns true when produceTypes is null (no filter)', () => {
		const listing = { type: 'apple' }
		const sub = { produceTypes: null }
		expect(listingMatchesProduceFilter(listing, sub)).toBeTruthy()
	})

	it('returns true when produceTypes is an empty JSON array', () => {
		const listing = { type: 'apple' }
		const sub = { produceTypes: '[]' }
		expect(listingMatchesProduceFilter(listing, sub)).toBeTruthy()
	})

	it('returns true when listing type is in the filter list', () => {
		const listing = { type: 'pear' }
		const sub = { produceTypes: JSON.stringify(['apple', 'pear', 'plum']) }
		expect(listingMatchesProduceFilter(listing, sub)).toBeTruthy()
	})

	it('returns false when listing type is not in the filter list', () => {
		const listing = { type: 'fig' }
		const sub = { produceTypes: JSON.stringify(['apple', 'pear', 'plum']) }
		expect(listingMatchesProduceFilter(listing, sub)).toBeFalsy()
	})

	it('returns false for a different type when filter has one entry', () => {
		const listing = { type: 'lemon' }
		const sub = { produceTypes: JSON.stringify(['orange']) }
		expect(listingMatchesProduceFilter(listing, sub)).toBeFalsy()
	})

	it('returns true for exact single-entry match', () => {
		const listing = { type: 'orange' }
		const sub = { produceTypes: JSON.stringify(['orange']) }
		expect(listingMatchesProduceFilter(listing, sub)).toBeTruthy()
	})
})

describe('resolution coarsening', () => {
	it('correctly coarsens a res-8 listing to res-7 for comparison', () => {
		// napaH3Res7 is the parent of napaH3Res8; subscription covers res-7 center
		const listing = { approximateH3Index: napaH3Res8 }
		const sub = { centerH3: napaH3Res7, resolution: 7, ringSize: 0 }
		// The listing's parent at res 7 should equal napaH3Res7
		expect(cellToParent(napaH3Res8, 7)).toBe(napaH3Res7)
		expect(listingMatchesSubscription(listing, sub)).toBeTruthy()
	})

	it('does not match a res-8 listing whose res-7 parent differs from subscription center', () => {
		const sacParentRes7 = cellToParent(sacH3Res8, 7)
		// Use Sac's res-7 as sub center, but Napa's res-8 as listing
		const listing = { approximateH3Index: napaH3Res8 }
		const sub = { centerH3: sacParentRes7, resolution: 7, ringSize: 0 }
		expect(listingMatchesSubscription(listing, sub)).toBeFalsy()
	})
})
