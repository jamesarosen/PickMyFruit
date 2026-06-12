import { describe, it, expect } from 'vitest'
import { latLngToCell, cellToParent } from 'h3-js'
import {
	filterListings,
	normalizeTypeFilter,
	presentTypes,
} from '../src/lib/listing-filters'
import { H3_RESOLUTIONS } from '../src/lib/h3-resolutions'

// Two listings in Napa, one near Susanville, CA — far enough that no
// neighborhood-resolution ancestor is shared.
const napaCell = cellToParent(
	latLngToCell(38.3, -122.3, 13),
	H3_RESOLUTIONS.PUBLIC_DETAIL
)
const susanvilleCell = cellToParent(
	latLngToCell(40.4, -120.65, 13),
	H3_RESOLUTIONS.PUBLIC_DETAIL
)
const napaArea = cellToParent(napaCell, 7)

const fig = { approximateH3Index: napaCell, type: 'fig' }
const apple = { approximateH3Index: napaCell, type: 'apple' }
const farLemon = { approximateH3Index: susanvilleCell, type: 'lemon' }
const all = [fig, apple, farLemon]

describe('normalizeTypeFilter', () => {
	it.each([
		['fig', 'fig'],
		['apple', 'apple'],
		['not-a-real-type', null],
		['', null],
		[null, null],
		[undefined, null],
	])('normalizes %j to %j', (input, expected) => {
		expect(normalizeTypeFilter(input)).toBe(expected)
	})
})

describe('filterListings', () => {
	it('passes everything through when no filters are set', () => {
		expect(filterListings(all, null, null)).toEqual(all)
	})

	it('filters by produce type alone', () => {
		expect(filterListings(all, null, 'fig')).toEqual([fig])
	})

	it('filters by area alone', () => {
		expect(filterListings(all, napaArea, null)).toEqual([fig, apple])
	})

	it('combines area and type filters with AND', () => {
		expect(filterListings(all, napaArea, 'apple')).toEqual([apple])
		expect(filterListings(all, napaArea, 'lemon')).toEqual([])
	})
})

describe('presentTypes', () => {
	it('returns distinct present types in catalog order with display labels', () => {
		expect(presentTypes([fig, apple, farLemon, { ...fig }])).toEqual([
			{ slug: 'apple', label: 'Apples' },
			{ slug: 'fig', label: 'Figs' },
			{ slug: 'lemon', label: 'Lemons' },
		])
	})

	it('returns empty for no listings', () => {
		expect(presentTypes([])).toEqual([])
	})
})
