import { createFileRoute } from '@tanstack/solid-router'
import { listingFormSchema } from '@/lib/validation'
import { geocodeAddress } from '@/lib/geocoding'
import { createListing } from '@/data/queries'

export const Route = createFileRoute('/api/listings')({
	server: {
		handlers: {
			async POST({ request }) {
				let body: unknown
				try {
					body = await request.json()
				} catch {
					return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
				}

				// Validate form data
				const parsed = listingFormSchema.safeParse(body)
				if (!parsed.success) {
					return Response.json({ error: parsed.error.flatten() }, { status: 400 })
				}

				const formData = parsed.data

				// Geocode the address
				let geocodeResult
				try {
					geocodeResult = await geocodeAddress({
						address: formData.address,
						city: formData.city,
						state: formData.state,
						zip: formData.zip || undefined,
					})
				} catch (error) {
					const message = error instanceof Error ? error.message : 'Geocoding failed'
					return Response.json({ error: message }, { status: 400 })
				}

				// Create the listing
				try {
					const listing = await createListing({
						name: formData.type, // Use fruit type as name for now
						type: formData.type,
						harvestWindow: formData.harvestWindow,
						address: formData.address,
						city: formData.city,
						state: formData.state,
						zip: formData.zip || null,
						lat: geocodeResult.lat,
						lng: geocodeResult.lng,
						h3Index: geocodeResult.h3Index,
						ownerName: formData.ownerName,
						ownerEmail: formData.ownerEmail || null,
						ownerPhone: formData.ownerPhone || null,
						notes: formData.notes || null,
						status: 'available',
					})

					return Response.json(listing, { status: 201 })
				} catch (error) {
					console.error('Failed to create listing:', error)
					return Response.json(
						{ error: 'Failed to create listing' },
						{ status: 500 }
					)
				}
			},
		},
	},
})
