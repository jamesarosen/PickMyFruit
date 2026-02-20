import { describe, it, expect } from 'vitest'
import { zoomToH3Resolution, H3_RESOLUTIONS } from '../src/lib/h3-resolutions'

describe('zoomToH3Resolution', () => {
	it('maps zoom 13 to H3 resolution 8', () => {
		expect(zoomToH3Resolution(13)).toBe(8)
	})

	it.each([
		[0, H3_RESOLUTIONS.MIN_AREA],
		[1, H3_RESOLUTIONS.MIN_AREA],
		[5, H3_RESOLUTIONS.MIN_AREA],
		[6, H3_RESOLUTIONS.MIN_AREA],
		[7, 4],
		[8, 4],
		[9, 5],
		[10, 6],
		[11, 7],
		[12, 7],
		[13, 8],
		[14, H3_RESOLUTIONS.MAX_PUBLIC_AREA],
		[15, H3_RESOLUTIONS.MAX_PUBLIC_AREA],
		[18, H3_RESOLUTIONS.MAX_PUBLIC_AREA],
		[20, H3_RESOLUTIONS.MAX_PUBLIC_AREA],
	])('zoom %d → H3 resolution %d', (zoom, expectedRes) => {
		expect(zoomToH3Resolution(zoom)).toBe(expectedRes)
	})

	it('never returns below MIN_AREA', () => {
		for (let z = 0; z <= 7; z++) {
			expect(zoomToH3Resolution(z)).toBeGreaterThanOrEqual(H3_RESOLUTIONS.MIN_AREA)
		}
	})

	it('never returns above MAX_PUBLIC_AREA', () => {
		for (let z = 14; z <= 22; z++) {
			expect(zoomToH3Resolution(z)).toBeLessThanOrEqual(
				H3_RESOLUTIONS.MAX_PUBLIC_AREA
			)
		}
	})

	it('is monotonically non-decreasing', () => {
		let prev = zoomToH3Resolution(0)
		for (let z = 1; z <= 22; z++) {
			const cur = zoomToH3Resolution(z)
			expect(cur).toBeGreaterThanOrEqual(prev)
			prev = cur
		}
	})

	it('handles fractional zoom levels', () => {
		const res = zoomToH3Resolution(13.5)
		expect(res).toBeGreaterThanOrEqual(H3_RESOLUTIONS.MIN_AREA)
		expect(res).toBeLessThanOrEqual(H3_RESOLUTIONS.MAX_PUBLIC_AREA)
	})
})
