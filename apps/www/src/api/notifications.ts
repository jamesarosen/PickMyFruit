import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'

/**
 * A topic with the current user's effective subscription state. Combines
 * Resend's topic catalog (`GET /topics`) with the user's per-topic prefs
 * (`GET /contacts/{email}/topics`), falling back to each topic's
 * `default_subscription` when the user has no explicit setting.
 */
export interface NotificationTopic {
	id: string
	name: string
	description: string | null
	subscribed: boolean
}

/**
 * Page-load payload for the Manage Notifications form.
 *
 * `available` is false when the host is not configured for Resend (e.g. dev
 * with `EMAIL_PROVIDER=console`), so the page can render an informative
 * message instead of an empty form.
 *
 * NOTE: the response is assumed to contain ≤ 10 topics — Resend's `/topics`
 * endpoint is unpaginated in our wrapper, and the form is designed for a
 * short, scrollable-free list. Revisit pagination if the catalog grows.
 */
export interface NotificationsPayload {
	available: boolean
	topics: NotificationTopic[]
}

/** Loads the topic catalog merged with the signed-in user's subscriptions. */
export const getNotifications = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async (): Promise<NotificationsPayload> => {
		const { auth } = await import('@/lib/auth.server')
		const headers = getRequestHeaders()
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const { serverEnv } = await import('@/lib/env.server')
		if (serverEnv.email.PROVIDER !== 'resend') {
			return { available: false, topics: [] }
		}

		const { listTopics, listContactTopics } =
			await import('@/lib/resend-topics.server')

		const [topics, contactTopics] = await Promise.all([
			listTopics(),
			listContactTopics(session.user.email).catch((error: unknown) => {
				// A contact that has never been synced to Resend returns 404 here;
				// treat that as "no explicit prefs" and fall back to topic defaults.
				if (
					error &&
					typeof error === 'object' &&
					'status' in error &&
					(error as { status: number }).status === 404
				) {
					return []
				}
				throw error
			}),
		])

		const subscriptionByTopicId = new Map(
			contactTopics.map((t) => [t.id, t.subscription])
		)

		return {
			available: true,
			topics: topics.map((t) => ({
				id: t.id,
				name: t.name,
				description: t.description ?? null,
				subscribed:
					(subscriptionByTopicId.get(t.id) ?? t.default_subscription) === 'opt_in',
			})),
		}
	})

const updateInputSchema = z.object({
	topicId: z.string().min(1),
	subscribed: z.boolean(),
})

/** Toggles the signed-in user's subscription for a single topic. */
export const updateNotificationSubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((input: unknown) => updateInputSchema.parse(input))
	.handler(async ({ data }) => {
		const { auth } = await import('@/lib/auth.server')
		const headers = getRequestHeaders()
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}
		const { serverEnv } = await import('@/lib/env.server')
		if (serverEnv.email.PROVIDER !== 'resend') {
			throw new UserError(
				'NOTIFICATIONS_UNAVAILABLE',
				'Notifications are not configured for this environment.'
			)
		}

		const { updateContactTopics } = await import('@/lib/resend-topics.server')
		await updateContactTopics(session.user.email, [
			{
				id: data.topicId,
				subscription: data.subscribed ? 'opt_in' : 'opt_out',
			},
		])
		return { ok: true as const }
	})
