import { describe, it, expect } from 'vitest'
import { latLngToCell, cellToParent } from 'h3-js'
import { normalizeArea, listingMatchesArea } from '../src/lib/h3-area'
import { H3_RESOLUTIONS } from '../src/lib/h3-resolutions'

const NAPA = { lat: 38.2975, lng: -122.2869 }
const res8Cell = latLngToCell(NAPA.lat, NAPA.lng, H3_RESOLUTIONS.PUBLIC_DETAIL)
const res7Cell = cellToParent(res8Cell, H3_RESOLUTIONS.HOME_GROUPING)
const res9Cell = latLngToCell(NAPA.lat, NAPA.lng, 9)
const res13Cell = latLngToCell(NAPA.lat, NAPA.lng, 13)
const res6Cell = cellToParent(res7Cell, 6)
const res5Cell = cellToParent(res7Cell, 5)
const res3Cell = cellToParent(res7Cell, H3_RESOLUTIONS.MIN_AREA)
const res2Cell = cellToParent(res7Cell, 2)

describe('normalizeArea', () => {
	it('returns null for null input', () => {
		expect(normalizeArea(null)).toBeNull()
	})

	it('returns null for empty string', () => {
		expect(normalizeArea('')).toBeNull()
	})

	it('returns null for invalid H3 index', () => {
		expect(normalizeArea('not-a-cell')).toBeNull()
		expect(normalizeArea('zzzzzzzzzzzzzzz')).toBeNull()
	})

	it('passes through resolution-7 cells unchanged', () => {
		expect(normalizeArea(res7Cell)).toBe(res7Cell)
	})

	it('passes through coarser cells unchanged', () => {
		expect(normalizeArea(res6Cell)).toBe(res6Cell)
		expect(normalizeArea(res5Cell)).toBe(res5Cell)
		expect(normalizeArea(res3Cell)).toBe(res3Cell)
	})

	it('returns null for cells coarser than minimum area', () => {
		expect(normalizeArea(res2Cell)).toBeNull()
	})

	it.each([
		['resolution 8', res8Cell],
		['resolution 9', res9Cell],
		['resolution 13', res13Cell],
	])('clamps %s to home-grouping resolution', (_label, fineCell) => {
		const result = normalizeArea(fineCell)
		expect(result).toBe(cellToParent(fineCell, H3_RESOLUTIONS.HOME_GROUPING))
	})

	it('never returns a cell finer than home-grouping resolution', () => {
		for (let res = H3_RESOLUTIONS.HOME_GROUPING + 1; res <= 15; res++) {
			const cell = latLngToCell(NAPA.lat, NAPA.lng, res)
			const result = normalizeArea(cell)
			expect(result).not.toBe(cell)
			expect(result).toBe(cellToParent(cell, H3_RESOLUTIONS.HOME_GROUPING))
		}
	})
})

describe('listingMatchesArea', () => {
	it('matches when listing H3 equals the area exactly', () => {
		expect(listingMatchesArea(res8Cell, res8Cell)).toBe(true)
	})

	it('does not match a different cell at the same resolution', () => {
		const otherRes8 = latLngToCell(40.0, -120.0, H3_RESOLUTIONS.PUBLIC_DETAIL)
		expect(listingMatchesArea(res8Cell, otherRes8)).toBe(false)
	})

	it('matches listings in a coarser parent cell', () => {
		expect(listingMatchesArea(res8Cell, res7Cell)).toBe(true)
		expect(listingMatchesArea(res8Cell, res6Cell)).toBe(true)
		expect(listingMatchesArea(res8Cell, res5Cell)).toBe(true)
	})

	it('does not match a coarser cell the listing is not in', () => {
		const otherRes7 = cellToParent(latLngToCell(40.0, -120.0, 8), 7)
		expect(listingMatchesArea(res8Cell, otherRes7)).toBe(false)
	})
})
