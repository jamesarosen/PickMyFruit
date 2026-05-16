import { createFileRoute } from '@tanstack/solid-router'

/**
 * `GET /internal/v1/users/next?cursor=<opaque>`
 *
 * Internal API consumed only by the resend-sync worker. Authenticated by a
 * shared secret in the `x-internal-auth` header and protected by a per-IP
 * rate limit on top. See `docs/0007-resend-sync-cron.md`.
 */
export const Route = createFileRoute('/internal/v1/users/next')({
	server: {
		handlers: {
			async GET({ request }) {
				const [
					{ serverEnv },
					{ handleInternalUsersNext, selectNextUser },
					{ getInternalRateLimiter },
					{ db },
				] = await Promise.all([
					import('@/lib/env.server'),
					import('@/lib/internal-users-next-handler.server'),
					import('@/lib/internal-rate-limit.server'),
					import('@/data/db.server'),
				])

				return handleInternalUsersNext(request, {
					auth: {
						current: serverEnv.INTERNAL_API_SECRET,
						previous: serverEnv.INTERNAL_API_SECRET_PREVIOUS,
					},
					limiter: getInternalRateLimiter(),
					loadUser: (cursor) => selectNextUser(db, cursor),
				})
			},
		},
	},
})
