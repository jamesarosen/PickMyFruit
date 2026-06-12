import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { errorMiddleware } from '@/lib/server-error-middleware'
import type { GeocodeForClientResult } from '@/lib/geocoding.server'

// Superset of listingFormSchema's address fields — generous caps so this
// boundary never rejects input the form schema accepted.
const geocodingInputSchema = z.object({
	address: z.string().trim().min(1).max(200),
	city: z.string().trim().min(1).max(100),
	state: z.string().trim().min(1).max(50),
	zip: z.preprocess(
		(val) => (val === '' || val == null ? undefined : val),
		z.string().trim().max(20).optional()
	),
})

/**
 * Geocodes a listing address via Nominatim, server-side. Returns coordinates
 * plus an HMAC token that createListing verifies, so clients cannot submit
 * tampered coordinates. Rate-limited per IP and globally.
 */
export const requestGeocode = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) => geocodingInputSchema.parse(data))
	.handler(async ({ data }): Promise<GeocodeForClientResult> => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const { geocodeForClient } = await import('@/lib/geocoding.server')
		return geocodeForClient(data, getRequestHeaders())
	})
