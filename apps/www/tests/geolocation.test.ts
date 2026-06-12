import { afterEach, describe, expect, it, vi } from 'vitest'
import { NAPA_CITY_HALL, requestCurrentLocation } from '../src/lib/geolocation'

/** Mirrors the numeric error codes of the GeolocationPositionError interface. */
const GEOLOCATION_ERROR_CODES = {
	PERMISSION_DENIED: 1,
	POSITION_UNAVAILABLE: 2,
	TIMEOUT: 3,
} as const

function stubGeolocation(getCurrentPosition: PositionCallback | unknown) {
	vi.stubGlobal('navigator', {
		...globalThis.navigator,
		geolocation: { getCurrentPosition },
	})
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('NAPA_CITY_HALL', () => {
	it('is the agreed fallback bias', () => {
		expect(NAPA_CITY_HALL).toEqual({ lat: 38.2967151, lng: -122.292037 })
	})
})

describe('requestCurrentLocation', () => {
	it('resolves the position when the user grants access', async () => {
		stubGeolocation((onSuccess: PositionCallback) => {
			onSuccess({
				coords: { latitude: 38.291859, longitude: -122.458036 },
			} as GeolocationPosition)
		})

		await expect(requestCurrentLocation()).resolves.toEqual({
			lat: 38.291859,
			lng: -122.458036,
		})
	})

	it.each(
		Object.entries(GEOLOCATION_ERROR_CODES).map(([name, code]) => ({
			name,
			code,
		}))
	)('resolves null on $name', async ({ code }) => {
		stubGeolocation(
			(_onSuccess: PositionCallback, onError: PositionErrorCallback) => {
				onError({ code, message: 'nope' } as GeolocationPositionError)
			}
		)

		await expect(requestCurrentLocation()).resolves.toBeNull()
	})

	it('resolves null when the Geolocation API is missing', async () => {
		vi.stubGlobal('navigator', {})

		await expect(requestCurrentLocation()).resolves.toBeNull()
	})

	it('accepts a coarse cached fix instead of forcing a fresh GPS read', async () => {
		let seenOptions: PositionOptions | undefined
		stubGeolocation(
			(
				onSuccess: PositionCallback,
				_onError: PositionErrorCallback,
				options?: PositionOptions
			) => {
				seenOptions = options
				onSuccess({
					coords: { latitude: 1, longitude: 2 },
				} as GeolocationPosition)
			}
		)

		await requestCurrentLocation()

		expect(seenOptions?.enableHighAccuracy).toBe(false)
		expect(seenOptions?.maximumAge).toBeGreaterThan(0)
		expect(seenOptions?.timeout).toBeGreaterThan(0)
	})
})
