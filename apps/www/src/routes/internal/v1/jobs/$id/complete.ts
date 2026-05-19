import { createFileRoute } from '@tanstack/solid-router'

/**
 * `POST /internal/v1/jobs/:id/complete` — marks the claimed row done; no-ops
 * if the lease has been reaped and reassigned to another worker.
 */
export const Route = createFileRoute('/internal/v1/jobs/$id/complete')({
	server: {
		handlers: {
			async POST({ request, params }) {
				const [
					{ serverEnv },
					{ handleComplete },
					{ getInternalRateLimiter },
					{ db },
					{ completeJob },
				] = await Promise.all([
					import('@/lib/env.server'),
					import('@/lib/internal-jobs-handler.server'),
					import('@/lib/internal-rate-limit.server'),
					import('@/data/db.server'),
					import('@/data/jobs.server'),
				])

				return handleComplete(request, String(params.id), {
					auth: {
						current: serverEnv.INTERNAL_API_SECRET,
						previous: serverEnv.INTERNAL_API_SECRET_PREVIOUS,
					},
					limiter: getInternalRateLimiter(),
					complete: (input) => completeJob(db, input),
				})
			},
		},
	},
})
