import { createFileRoute } from '@tanstack/solid-router'

/**
 * `POST /internal/v1/jobs/:id/fail` — records a worker failure. With
 * `retryInSeconds` in the body, the row is unclaimed and re-armed at
 * `now + retryInSeconds`. Without it, the row is marked permanently failed.
 */
export const Route = createFileRoute('/internal/v1/jobs/$id/fail')({
	server: {
		handlers: {
			async POST({ request, params }) {
				const [
					{ serverEnv },
					{ handleFail },
					{ getInternalRateLimiter },
					{ db },
					{ failJob },
				] = await Promise.all([
					import('@/lib/env.server'),
					import('@/lib/internal-jobs-handler.server'),
					import('@/lib/internal-rate-limit.server'),
					import('@/data/db.server'),
					import('@/data/jobs.server'),
				])

				return handleFail(request, String(params.id), {
					auth: {
						current: serverEnv.INTERNAL_API_SECRET,
						previous: serverEnv.INTERNAL_API_SECRET_PREVIOUS,
					},
					limiter: getInternalRateLimiter(),
					fail: (input) => failJob(db, input),
				})
			},
		},
	},
})
