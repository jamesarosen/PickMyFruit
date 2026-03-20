import { createFileRoute, redirect } from '@tanstack/solid-router'
import { z } from 'zod'
import { Sentry } from '@/lib/sentry'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
})

const querySchema = z.object({
	userId: z.string().uuid(),
	sig: z.string().min(1),
})

async function handleUnsubscribe(
	request: Request,
	params: Record<string, string>
): Promise<Response> {
	const { verifyUnsubscribeSignature } = await import('@/lib/hmac')
	const { deleteSubscription } = await import('@/data/queries')

	const parsedParams = paramsSchema.safeParse(params)
	if (!parsedParams.success) {
		return Response.json({ error: 'Invalid subscription ID' }, { status: 400 })
	}

	const url = new URL(request.url)
	const parsedQuery = querySchema.safeParse({
		userId: url.searchParams.get('userId'),
		sig: url.searchParams.get('sig'),
	})

	if (!parsedQuery.success) {
		return Response.json(
			{ error: 'Missing or invalid userId or sig parameter' },
			{ status: 400 }
		)
	}

	const { id } = parsedParams.data
	const { userId, sig } = parsedQuery.data

	if (!verifyUnsubscribeSignature(id, userId, sig)) {
		Sentry.captureMessage('Invalid unsubscribe signature', {
			level: 'warning',
			extra: { subscriptionId: id },
		})
		return Response.json({ error: 'Invalid signature' }, { status: 403 })
	}

	try {
		// deleteSubscription is idempotent — already-deleted subscriptions return false
		await deleteSubscription(id, userId)

		throw redirect({ to: '/notifications/unsubscribed' })
	} catch (error) {
		if (
			error instanceof Response ||
			(error as Record<string, unknown>)?.isRedirect
		) {
			throw error
		}
		Sentry.captureException(error)
		return Response.json({ error: 'Failed to unsubscribe' }, { status: 500 })
	}
}

export const Route = createFileRoute('/api/notifications/$id/unsubscribe')({
	server: {
		handlers: {
			/** Browser click: verify signature, delete subscription, redirect to confirmation. */
			GET({ request, params }) {
				return handleUnsubscribe(request, params)
			},
			/**
			 * RFC 8058 one-click unsubscribe: email clients POST to this URL with body
			 * `List-Unsubscribe=One-Click`. Params are in the query string (same URL).
			 * Returns 200 on success rather than redirecting — email clients don't follow redirects.
			 */
			async POST({ request, params }) {
				try {
					// handleUnsubscribe only returns (not throws) for error responses
					return await handleUnsubscribe(request, params)
				} catch (error) {
					if (
						error instanceof Response ||
						(error as Record<string, unknown>)?.isRedirect
					) {
						// Success path: redirect thrown means subscription was deleted.
						// Email clients don't follow redirects, so return 200.
						return new Response(null, { status: 200 })
					}
					throw error
				}
			},
		},
	},
})
