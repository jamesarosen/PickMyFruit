import { describe, it, expect, vi, beforeEach } from 'vitest'
import { geocodeAddress } from '@/lib/geocode'

describe(geocodeAddress, () => {
	beforeEach(() => {
		vi.restoreAllMocks()
	})

	it('returns parsed result for valid address', async () => {
		vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify([
						{ lat: '38.2966234', lon: '-122.2893688', display_name: 'Napa, CA' },
					]),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				)
			)
		const result = await geocodeAddress('Napa, CA')
		expect(result).toEqual({
			lat: 38.2966234,
			lng: -122.2893688,
			displayName: 'Napa, CA',
		})
	})

	it('returns null for empty results', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			})
		)
		const result = await geocodeAddress('zzz no results')
		expect(result).toBeNull()
	})

	it('returns null on non-ok response', async () => {
		vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response('', { status: 500 }))
		const result = await geocodeAddress('anything')
		expect(result).toBeNull()
	})
})
