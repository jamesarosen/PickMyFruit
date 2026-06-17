import { describe, expect, it } from 'vitest'
import {
	DEFAULT_MAP_ZOOM,
	NAPA_CITY_HALL_LNGLAT,
	planListingsMapCamera,
} from '../src/lib/listings-map-camera'
import { NAPA_CITY_HALL } from '../src/lib/geolocation'

describe('planListingsMapCamera', () => {
	it('centers on the user position when known, overriding listing groups', () => {
		expect(
			planListingsMapCamera(true, { lat: 38.291859, lng: -122.458036 })
		).toEqual({
			kind: 'center',
			center: [-122.458036, 38.291859],
			zoom: DEFAULT_MAP_ZOOM,
		})
	})

	it('centers on the user position even when there are no groups', () => {
		expect(planListingsMapCamera(false, { lat: 1, lng: 2 })).toEqual({
			kind: 'center',
			center: [2, 1],
			zoom: DEFAULT_MAP_ZOOM,
		})
	})

	it.each([null, undefined])(
		'fits the listing groups when the position is %s',
		(userCenter) => {
			expect(planListingsMapCamera(true, userCenter)).toEqual({
				kind: 'fit-groups',
			})
		}
	)

	it('falls back to Napa City Hall when the position is unknown and there are no groups', () => {
		expect(planListingsMapCamera(false, null)).toEqual({
			kind: 'center',
			center: NAPA_CITY_HALL_LNGLAT,
			zoom: DEFAULT_MAP_ZOOM,
		})
	})

	it('derives the Napa fallback from the shared geolocation constant', () => {
		expect(NAPA_CITY_HALL_LNGLAT).toEqual([
			NAPA_CITY_HALL.lng,
			NAPA_CITY_HALL.lat,
		])
	})
})
