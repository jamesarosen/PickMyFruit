import { createFileRoute } from '@tanstack/solid-router'
import { inquiryFormSchema, ListingStatus } from '@/lib/validation'

export const Route = createFileRoute('/api/inquiries')({
	server: {
		handlers: {
			async POST({ request }) {
				// Dynamic imports to avoid bundling server-only code for browser
				const { auth } = await import('@/lib/auth')
				const {
					createInquiry,
					hasRecentInquiry,
					getListingWithOwner,
					getUserById,
					markInquiryEmailSent,
				} = await import('@/data/queries')
				const { sendInquiryEmail } = await import('@/lib/email-templates')

				// Require authentication
				const session = await auth.api.getSession({
					headers: request.headers,
				})

				if (!session?.user) {
					return Response.json({ error: 'Authentication required' }, { status: 401 })
				}

				let body: unknown
				try {
					body = await request.json()
				} catch {
					return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
				}

				// Validate form data
				const parsed = inquiryFormSchema.safeParse(body)
				if (!parsed.success) {
					return Response.json({ error: parsed.error.flatten() }, { status: 400 })
				}

				const { listingId, note } = parsed.data

				// Get listing with owner info
				const result = await getListingWithOwner(listingId)
				if (!result) {
					return Response.json({ error: 'Listing not found' }, { status: 404 })
				}

				const { listing, owner } = result

				// Check listing status allows inquiries
				if (
					listing.status !== ListingStatus.available &&
					listing.status !== ListingStatus.private
				) {
					return Response.json(
						{ error: 'This listing is not accepting inquiries' },
						{ status: 404 }
					)
				}

				// Cannot inquire on own listing
				if (listing.userId === session.user.id) {
					return Response.json(
						{ error: 'You cannot inquire about your own listing' },
						{ status: 400 }
					)
				}

				// Check rate limit
				const hasRecent = await hasRecentInquiry(session.user.id, listingId)
				if (hasRecent) {
					return Response.json(
						{
							error:
								'You have already contacted this owner recently. Please wait 24 hours before trying again.',
						},
						{ status: 400 }
					)
				}

				// Get gleaner info
				const gleaner = await getUserById(session.user.id)
				if (!gleaner) {
					return Response.json({ error: 'User not found' }, { status: 400 })
				}

				// Create inquiry record
				const inquiry = await createInquiry({
					listingId,
					gleanerId: session.user.id,
					note: note || null,
				})

				// Attempt to send email
				const baseUrl = new URL(request.url).origin
				const emailSent = await sendInquiryEmail({
					ownerName: owner.name,
					ownerEmail: owner.email,
					gleanerName: gleaner.name,
					gleanerEmail: gleaner.email,
					gleanerNote: note,
					produceType: listing.type,
					quantity: listing.quantity,
					listingNotes: listing.notes,
					plantId: listing.id,
					baseUrl,
				})

				// Update emailSentAt if successful
				if (emailSent) {
					await markInquiryEmailSent(inquiry.id)
				}

				return Response.json(
					{
						success: true,
						inquiryId: inquiry.id,
						emailSent,
					},
					{ status: 201 }
				)
			},
		},
	},
})
