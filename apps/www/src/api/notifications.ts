import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import {
	createSubscriptionSchema,
	updateSubscriptionSchema,
	MAX_SUBSCRIPTIONS_PER_USER,
} from '@/lib/validation'
import type { NotificationSubscription } from '@/data/schema'

/** Returns a single subscription by id if it belongs to the current user, or undefined. */
export const getMySubscriptionById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) =>
		z.object({ id: z.number().int().positive() }).parse(data)
	)
	.handler(
		async ({ data: { id } }): Promise<NotificationSubscription | undefined> => {
			const { getRequestHeaders } = await import('@tanstack/solid-start/server')
			const headers = getRequestHeaders()
			const { auth } = await import('@/lib/auth')
			const session = await auth.api.getSession({ headers })
			if (!session?.user) {
				return undefined
			}
			const { getSubscriptionById } = await import('@/data/queries')
			const sub = await getSubscriptionById(id)
			if (!sub || sub.userId !== session.user.id) {
				return undefined
			}
			return sub
		}
	)

/** Returns the current user's notification subscriptions, or [] if not authenticated. */
export const getMySubscriptions = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async (): Promise<NotificationSubscription[]> => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return []
		}
		const { getUserSubscriptions } = await import('@/data/queries')
		return getUserSubscriptions(session.user.id)
	})

/** Creates a new notification subscription for the current user. */
export const createSubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) => createSubscriptionSchema.parse(data))
	.handler(async ({ data }): Promise<NotificationSubscription> => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Please sign in')
		}
		const { getUserSubscriptions, createSubscription: query } =
			await import('@/data/queries')
		const existing = await getUserSubscriptions(session.user.id)
		if (existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
			throw new UserError(
				'LIMIT_EXCEEDED',
				`You may have at most ${MAX_SUBSCRIPTIONS_PER_USER} subscriptions`
			)
		}
		return query({
			userId: session.user.id,
			locationName: data.locationName,
			throttlePeriod: data.throttlePeriod,
			produceTypes: data.produceTypes ? JSON.stringify(data.produceTypes) : null,
			centerH3: data.centerH3,
			resolution: data.resolution,
			ringSize: data.ringSize,
		})
	})

/** Updates a subscription owned by the current user. */
export const updateSubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) => updateSubscriptionSchema.parse(data))
	.handler(async ({ data }): Promise<NotificationSubscription> => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Please sign in')
		}
		const { updateSubscription: query } = await import('@/data/queries')
		const { id, ...fields } = data
		const result = await query(id, session.user.id, {
			...(fields.throttlePeriod !== undefined && {
				throttlePeriod: fields.throttlePeriod,
			}),
			...(fields.produceTypes !== undefined && {
				produceTypes: fields.produceTypes
					? JSON.stringify(fields.produceTypes)
					: null,
			}),
			...(fields.locationName !== undefined && {
				locationName: fields.locationName,
			}),
			...(fields.centerH3 !== undefined && { centerH3: fields.centerH3 }),
			...(fields.resolution !== undefined && { resolution: fields.resolution }),
			...(fields.ringSize !== undefined && { ringSize: fields.ringSize }),
		})
		if (!result) {
			throw new UserError('NOT_FOUND', 'Subscription not found')
		}
		return result
	})

/** Deletes a subscription owned by the current user. */
export const deleteSubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) =>
		z.object({ id: z.number().int().positive() }).parse(data)
	)
	.handler(async ({ data: { id } }): Promise<void> => {
		const { getRequestHeaders } = await import('@tanstack/solid-start/server')
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Please sign in')
		}
		const { deleteSubscription: query } = await import('@/data/queries')
		const deleted = await query(id, session.user.id)
		if (!deleted) {
			throw new UserError('NOT_FOUND', 'Subscription not found')
		}
	})
