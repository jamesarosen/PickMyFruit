import { createServerFn } from '@tanstack/solid-start'
import { inquiryFormSchema, ListingStatus } from '@/lib/validation'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'

export const submitInquiry = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: { listingId: number; note?: string }) =>
		inquiryFormSchema.parse(data)
	)
	.handler(async ({ data: { listingId, note } }) => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const { createInquiry, hasRecentInquiry, getListingWithOwner, getUserById } =
			await import('@/data/queries')

		const result = await getListingWithOwner(listingId)
		if (!result) {
			throw new UserError('NOT_FOUND', 'Listing not found')
		}

		const { listing, owner } = result

		if (
			listing.status !== ListingStatus.available &&
			listing.status !== ListingStatus.private
		) {
			throw new UserError('NOT_ALLOWED', 'This listing is not accepting inquiries')
		}

		if (listing.userId === session.user.id) {
			throw new UserError(
				'NOT_ALLOWED',
				'You cannot inquire about your own listing'
			)
		}

		const hasRecent = await hasRecentInquiry(session.user.id, listingId)
		if (hasRecent) {
			throw new UserError(
				'RATE_LIMITED',
				'You have already contacted this owner recently. Please wait 24 hours before trying again.'
			)
		}

		const gleaner = await getUserById(session.user.id)
		if (!gleaner) {
			throw new UserError('NOT_FOUND', 'User not found')
		}

		// Send email first — if it fails, no inquiry record is created
		// so the user can retry.
		const { getRequestBaseUrl } = await import('@/lib/request-url')
		const baseUrl = getRequestBaseUrl(headers)
		const { sendInquiryEmail } = await import('@/lib/email-templates')
		try {
			await sendInquiryEmail({
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
		} catch (error) {
			const { Sentry } = await import('@/lib/sentry')
			Sentry.captureException(error, {
				extra: { listingId, gleanerId: session.user.id },
			})
			throw new UserError(
				'EMAIL_FAILED',
				"We couldn't send the notification email. Please try again."
			)
		}

		const inquiry = await createInquiry({
			listingId,
			gleanerId: session.user.id,
			note: note || null,
			emailSentAt: new Date(),
		})

		return { inquiryId: inquiry.id }
	})
