import { describe, expect, it } from 'vitest'
import { faker } from '@faker-js/faker'
import {
	GEOCODE_TOKEN_MAX_AGE_MS,
	signGeocodeResult,
	verifyGeocodeToken,
} from '../src/lib/geocode-token.server'
import type { GeocodingInput } from '../src/lib/geocoding'

function makeInput(): GeocodingInput {
	return {
		address: faker.location.streetAddress(),
		city: faker.location.city(),
		state: faker.location.state({ abbreviated: true }),
		zip: faker.location.zipCode('#####'),
	}
}

describe('geocode token', () => {
	it('round-trips: a signed result verifies', () => {
		const input = makeInput()
		const lat = faker.location.latitude()
		const lng = faker.location.longitude()

		const token = signGeocodeResult(input, lat, lng)

		expect(verifyGeocodeToken(input, lat, lng, token)).toBe(true)
	})

	it.each([
		{
			label: 'lat',
			mutate: (lat: number, lng: number, input: GeocodingInput) =>
				[lat + 0.001, lng, input] as const,
		},
		{
			label: 'lng',
			mutate: (lat: number, lng: number, input: GeocodingInput) =>
				[lat, lng + 0.001, input] as const,
		},
		{
			label: 'address',
			mutate: (lat: number, lng: number, input: GeocodingInput) =>
				[lat, lng, { ...input, address: `${input.address} Unit 2` }] as const,
		},
		{
			label: 'city',
			mutate: (lat: number, lng: number, input: GeocodingInput) =>
				[lat, lng, { ...input, city: `${input.city}x` }] as const,
		},
		{
			label: 'zip',
			mutate: (lat: number, lng: number, input: GeocodingInput) =>
				[lat, lng, { ...input, zip: '00000' }] as const,
		},
	])('rejects when $label is tampered', ({ mutate }) => {
		const input = makeInput()
		const lat = faker.location.latitude()
		const lng = faker.location.longitude()
		const token = signGeocodeResult(input, lat, lng)

		const [newLat, newLng, newInput] = mutate(lat, lng, input)

		expect(verifyGeocodeToken(newInput, newLat, newLng, token)).toBe(false)
	})

	it('rejects a tampered signature', () => {
		const input = makeInput()
		const token = signGeocodeResult(input, 38.0, -122.0)
		const flipped = token.sig.startsWith('a')
			? `b${token.sig.slice(1)}`
			: `a${token.sig.slice(1)}`

		expect(
			verifyGeocodeToken(input, 38.0, -122.0, { ts: token.ts, sig: flipped })
		).toBe(false)
	})

	it('rejects expired tokens but accepts within the window', () => {
		const input = makeInput()
		const signedAt = Date.now()
		const token = signGeocodeResult(input, 38.0, -122.0, signedAt)

		expect(
			verifyGeocodeToken(
				input,
				38.0,
				-122.0,
				token,
				signedAt + GEOCODE_TOKEN_MAX_AGE_MS - 1
			)
		).toBe(true)
		expect(
			verifyGeocodeToken(
				input,
				38.0,
				-122.0,
				token,
				signedAt + GEOCODE_TOKEN_MAX_AGE_MS + 1
			)
		).toBe(false)
	})

	it('rejects tokens whose timestamp is in the future', () => {
		const input = makeInput()
		const now = Date.now()
		const token = signGeocodeResult(input, 38.0, -122.0, now + 60_000)

		expect(verifyGeocodeToken(input, 38.0, -122.0, token, now)).toBe(false)
	})

	it('treats absent zip and empty-string zip as equivalent', () => {
		const base = makeInput()
		const input: GeocodingInput = { ...base, zip: undefined }
		const token = signGeocodeResult(input, 38.0, -122.0)

		expect(verifyGeocodeToken({ ...base, zip: '' }, 38.0, -122.0, token)).toBe(
			true
		)
	})

	it('ignores surrounding whitespace in address fields', () => {
		const base = makeInput()
		const token = signGeocodeResult(base, 38.0, -122.0)

		expect(
			verifyGeocodeToken(
				{ ...base, address: `  ${base.address}  ` },
				38.0,
				-122.0,
				token
			)
		).toBe(true)
	})
})
