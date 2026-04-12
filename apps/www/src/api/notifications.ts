import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import type { NotificationSubscription } from '@/data/schema'
import {
	createSubscriptionSchema,
	updateSubscriptionSchema,
	type CreateSubscriptionData,
	type UpdateSubscriptionData,
} from '@/lib/validation'

const subscriptionIdValidator = z.coerce.number().int().positive()

/** Geocodes a plain string address query for the subscription form. */
export const geocodeForSubscription = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((query: string) => z.string().min(1).parse(query))
	.handler(
		async ({
			data: query,
		}): Promise<{ lat: number; lng: number; displayName: string } | null> => {
			const { geocodeAddress, GeocodingError } = await import('@/lib/geocoding')
			const { Sentry } = await import('@/lib/sentry')
			try {
				const result = await geocodeAddress(query)
				if (!result) return null
				return { lat: result.lat, lng: result.lng, displayName: result.displayName }
			} catch (error) {
				if (error instanceof GeocodingError) {
					Sentry.captureException(error, { extra: { query } })
					throw new UserError(
						'GEOCODING_ERROR',
						'Location search is temporarily unavailable — try again in a moment.'
					)
				}
				throw error
			}
		}
	)

/** Returns all non-deleted subscriptions for the authenticated user. */
export const getMySubscriptions = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async (): Promise<NotificationSubscription[]> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return []
		}
		const { getUserNotificationSubscriptions } =
			await import('@/data/queries.server')
		return getUserNotificationSubscriptions(session.user.id)
	})

/** Returns a single subscription owned by the authenticated user. Throws if not found. */
export const getMySubscription = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => subscriptionIdValidator.parse(id))
	.handler(async ({ data: id }): Promise<NotificationSubscription> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Authentication required.')
		}
		const { getUserNotificationSubscription } =
			await import('@/data/queries.server')
		const sub = await getUserNotificationSubscription(session.user.id, id)
		if (!sub) {
			throw new UserError('NOT_FOUND', 'Subscription not found.')
		}
		return sub
	})

/** Creates a subscription for the authenticated user. */
export const createMySubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: CreateSubscriptionData) =>
		createSubscriptionSchema.parse(data)
	)
	.handler(async ({ data }): Promise<NotificationSubscription> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Authentication required.')
		}
		const { createNotificationSubscription } =
			await import('@/data/queries.server')
		return createNotificationSubscription({
			userId: session.user.id,
			label: data.label ?? null,
			centerH3: data.centerH3,
			resolution: data.resolution,
			ringSize: data.ringSize,
			placeName: data.placeName,
			produceTypes: data.produceTypes ? JSON.stringify(data.produceTypes) : null,
			throttlePeriod: data.throttlePeriod,
		})
	})

/** Updates a subscription owned by the authenticated user. */
export const updateMySubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((input: { id: number; data: UpdateSubscriptionData }) => ({
		id: subscriptionIdValidator.parse(input.id),
		data: updateSubscriptionSchema.parse(input.data),
	}))
	.handler(async ({ data: input }): Promise<NotificationSubscription> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Authentication required.')
		}
		const { updateNotificationSubscription } =
			await import('@/data/queries.server')

		const updates: Partial<
			Pick<
				NotificationSubscription,
				| 'label'
				| 'centerH3'
				| 'resolution'
				| 'ringSize'
				| 'placeName'
				| 'produceTypes'
				| 'throttlePeriod'
				| 'enabled'
			>
		> = {}
		if (input.data.label !== undefined) updates.label = input.data.label ?? null
		if (input.data.centerH3 !== undefined) updates.centerH3 = input.data.centerH3
		if (input.data.resolution !== undefined)
			updates.resolution = input.data.resolution
		if (input.data.ringSize !== undefined) updates.ringSize = input.data.ringSize
		if (input.data.placeName !== undefined)
			updates.placeName = input.data.placeName
		if (input.data.produceTypes !== undefined) {
			updates.produceTypes = input.data.produceTypes
				? JSON.stringify(input.data.produceTypes)
				: null
		}
		if (input.data.throttlePeriod !== undefined) {
			updates.throttlePeriod = input.data.throttlePeriod
		}
		if (input.data.enabled !== undefined) updates.enabled = input.data.enabled

		const updated = await updateNotificationSubscription(
			session.user.id,
			input.id,
			updates
		)
		if (!updated) {
			throw new UserError('NOT_FOUND', 'Subscription not found.')
		}
		return updated
	})

/** Soft-deletes a subscription owned by the authenticated user. */
export const deleteMySubscription = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => subscriptionIdValidator.parse(id))
	.handler(async ({ data: id }): Promise<void> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			throw new UserError('UNAUTHORIZED', 'Authentication required.')
		}
		const { deleteNotificationSubscription } =
			await import('@/data/queries.server')
		await deleteNotificationSubscription(session.user.id, id)
	})
