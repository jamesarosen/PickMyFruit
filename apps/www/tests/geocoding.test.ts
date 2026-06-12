import { beforeEach, describe, expect, it, vi } from 'vitest'
import { faker } from '@faker-js/faker'

const mockRequestGeocode = vi.fn()

vi.mock('../src/api/geocoding', () => ({
	requestGeocode: (...args: unknown[]) => mockRequestGeocode(...args),
}))

const { geocodeAddress, GeocodingNetworkError, GeocodingNotFoundError } =
	await import('../src/lib/geocoding')

function makeInput() {
	return {
		address: faker.location.streetAddress(),
		city: faker.location.city(),
		state: faker.location.state({ abbreviated: true }),
	}
}

describe('geocodeAddress (client wrapper)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns coordinates plus the provenance token on success', async () => {
		mockRequestGeocode.mockResolvedValue({
			ok: true,
			lat: 38.2975,
			lng: -122.2869,
			ts: 1781200000000,
			sig: 'abc123',
		})

		const result = await geocodeAddress(makeInput())

		expect(result).toEqual({
			lat: 38.2975,
			lng: -122.2869,
			geocodeTs: 1781200000000,
			geocodeSig: 'abc123',
		})
	})

	it('throws GeocodingNotFoundError for NOT_FOUND', async () => {
		mockRequestGeocode.mockResolvedValue({ ok: false, code: 'NOT_FOUND' })

		await expect(geocodeAddress(makeInput())).rejects.toThrow(
			GeocodingNotFoundError
		)
	})

	it('throws a retryable GeocodingNetworkError for RATE_LIMITED', async () => {
		mockRequestGeocode.mockResolvedValue({ ok: false, code: 'RATE_LIMITED' })

		await expect(geocodeAddress(makeInput())).rejects.toThrow(/busy/)
	})

	it('throws GeocodingNetworkError for UNAVAILABLE', async () => {
		mockRequestGeocode.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' })

		await expect(geocodeAddress(makeInput())).rejects.toThrow(
			GeocodingNetworkError
		)
	})
})
