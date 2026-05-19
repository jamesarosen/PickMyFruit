import { createFileRoute } from '@tanstack/solid-router'

/**
 * `POST /internal/v1/jobs/claim` — atomically reaps expired leases and claims
 * the next eligible job for the requesting worker. Same auth + rate-limit
 * posture as `/internal/v1/users/next`.
 */
export const Route = createFileRoute('/internal/v1/jobs/claim')({
	server: {
		handlers: {
			async POST({ request }) {
				const [
					{ serverEnv },
					{ handleClaim },
					{ getInternalRateLimiter },
					{ db },
					{ claimNextJob },
				] = await Promise.all([
					import('@/lib/env.server'),
					import('@/lib/internal-jobs-handler.server'),
					import('@/lib/internal-rate-limit.server'),
					import('@/data/db.server'),
					import('@/data/jobs.server'),
				])

				return handleClaim(request, {
					auth: {
						current: serverEnv.INTERNAL_API_SECRET,
						previous: serverEnv.INTERNAL_API_SECRET_PREVIOUS,
					},
					limiter: getInternalRateLimiter(),
					claim: (input) => claimNextJob(db, input),
				})
			},
		},
	},
})
