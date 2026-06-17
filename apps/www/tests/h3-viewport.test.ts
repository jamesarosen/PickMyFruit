import { describe, it, expect } from 'vitest'
import { getResolution, latLngToCell } from 'h3-js'
import {
	viewportToCells,
	isValidViewport,
	MAX_MERCATOR_LAT,
	type ViewportBounds,
} from '../src/lib/h3-viewport'

const NAPA = { lat: 38.2975, lng: -122.2869 }

/** A small (neighborhood-ish) viewport around a point. */
function viewportAround(lat: number, lng: number, half = 0.02): ViewportBounds {
	return {
		north: lat + half,
		south: lat - half,
		east: lng + half,
		west: lng - half,
	}
}

describe('isValidViewport', () => {
	it('accepts an ordered, in-range rectangle', () => {
		expect(isValidViewport(viewportAround(NAPA.lat, NAPA.lng))).toBe(true)
	})

	it.each<[string, ViewportBounds]>([
		['south >= north', { north: 10, south: 20, east: 5, west: 0 }],
		[
			'west >= east (incl. antimeridian)',
			{ north: 10, south: 0, east: -170, west: 170 },
		],
		['latitude beyond Mercator', { north: 89, south: 80, east: 5, west: 0 }],
		['longitude out of range', { north: 10, south: 0, east: 200, west: 0 }],
		['non-finite', { north: NaN, south: 0, east: 5, west: 0 }],
	])('rejects %s', (_label, bounds) => {
		expect(isValidViewport(bounds)).toBe(false)
	})
})

describe('viewportToCells', () => {
	it('covers a small viewport with resolution-8 cells', () => {
		const cover = viewportToCells(viewportAround(NAPA.lat, NAPA.lng))
		expect(cover.kind).toBe('cells')
		if (cover.kind !== 'cells') return
		expect(cover.cells.length).toBeGreaterThan(0)
		// The privacy floor: nothing finer than public detail (res 8) is ever
		// emitted, so membership can only flip at res-8 boundaries.
		for (const cell of cover.cells) {
			expect(getResolution(cell)).toBe(8)
		}
		// A point inside the viewport is covered by its own res-8 cell.
		expect(cover.cells).toContain(latLngToCell(NAPA.lat, NAPA.lng, 8))
	})

	it('emits only resolution-8 cells regardless of viewport size', () => {
		for (const half of [0.005, 0.05, 0.2]) {
			const cover = viewportToCells(viewportAround(NAPA.lat, NAPA.lng, half))
			if (cover.kind !== 'cells') continue
			for (const cell of cover.cells) {
				expect(getResolution(cell)).toBe(8)
			}
		}
	})

	it('reports a continent-sized viewport as too-broad rather than enumerating millions of cells', () => {
		const cover = viewportToCells({
			north: MAX_MERCATOR_LAT,
			south: -MAX_MERCATOR_LAT,
			east: 179,
			west: -179,
		})
		expect(cover.kind).toBe('too-broad')
	})

	it('returns an empty cover for an invalid viewport', () => {
		const cover = viewportToCells({ north: 0, south: 10, east: 5, west: 0 })
		expect(cover).toEqual({ kind: 'cells', cells: [] })
	})

	it('membership cannot change at finer than res-8: two centers in the same cell cover the same cells', () => {
		// Two points a few metres apart that share a res-8 cell. A tiny viewport
		// around each must cover an identical set, so panning between them reveals
		// nothing — the triangulation defence.
		const a = { lat: NAPA.lat, lng: NAPA.lng }
		const b = { lat: NAPA.lat + 0.0002, lng: NAPA.lng + 0.0002 }
		expect(latLngToCell(a.lat, a.lng, 8)).toBe(latLngToCell(b.lat, b.lng, 8))

		const coverA = viewportToCells(viewportAround(a.lat, a.lng, 0.001))
		const coverB = viewportToCells(viewportAround(b.lat, b.lng, 0.001))
		if (coverA.kind !== 'cells' || coverB.kind !== 'cells') {
			throw new Error('expected concrete covers')
		}
		expect([...coverA.cells].sort()).toEqual([...coverB.cells].sort())
	})
})
