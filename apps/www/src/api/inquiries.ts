import { createServerFn } from '@tanstack/solid-start'
import { inquiryFormSchema, ListingStatus } from '@/lib/validation'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import { displayName } from '@/lib/display-name'

/**
 * Cap on inquiries per user per trailing 24h, across all listings. The
 * per-listing gate (hasRecentInquiry) cannot stop one account from spamming
 * every listing in an area; each inquiry emails a real person.
 */
export const MAX_INQUIRIES_PER_DAY = 10

export const submitInquiry = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: { listingId: number; note?: string }) =>
		inquiryFormSchema.parse(data)
	)
	.handler(async ({ data: { listingId, note } }) => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const {
			countRecentInquiriesByUser,
			hasRecentInquiry,
			getListingWithOwner,
			getUserById,
		} = await import('@/data/queries.server')

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

		const recentCount = await countRecentInquiriesByUser(session.user.id)
		if (recentCount >= MAX_INQUIRIES_PER_DAY) {
			throw new UserError(
				'RATE_LIMITED',
				'You have reached the daily limit for produce requests. Please try again tomorrow.'
			)
		}

		const gleaner = await getUserById(session.user.id)
		if (!gleaner) {
			throw new UserError('NOT_FOUND', 'User not found')
		}

		const { getRequestBaseUrl } = await import('@/lib/request-url')
		const baseUrl = getRequestBaseUrl(headers)

		// Side effects (Resend send + inquiry insert) run inside a durable
		// workflow so a crash between them does not leave the owner without an
		// email or the system without a record. The handler awaits the result so
		// the UX stays synchronous: the form sees `{ inquiryId }` only after both
		// steps have committed.
		const { getRuntime } = await import('@/lib/kokoto.server')
		const { submitInquiryWorkflow, inquiryWorkflowIdempotencyKey } =
			await import('@/workflows/submit-inquiry.workflow.server')

		const runtime = getRuntime()
		const handle = await runtime.startWorkflow(
			submitInquiryWorkflow,
			{
				listingId,
				gleanerId: session.user.id,
				note: note ?? null,
				baseUrl,
				gleaner: { ...gleaner, name: displayName(gleaner) },
				owner: { ...owner, name: displayName(owner) },
				listing: {
					id: listing.id,
					type: listing.type,
					notes: listing.notes ?? null,
					quantity: listing.quantity ?? null,
				},
			},
			{
				idempotencyKey: inquiryWorkflowIdempotencyKey(listingId, session.user.id),
			}
		)

		try {
			const { inquiryId } = await handle.result({ timeoutMs: 60_000 })
			return { inquiryId }
		} catch (error) {
			const { Sentry } = await import('@/lib/sentry')
			Sentry.captureException(error, {
				extra: {
					listingId,
					gleanerId: session.user.id,
					workflowId: handle.id,
				},
			})
			throw new UserError(
				'EMAIL_FAILED',
				"We couldn't send the notification email. Please try again."
			)
		}
	})
