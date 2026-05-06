import { serverEnv } from '@/lib/env.server'
import { Sentry } from '@/lib/sentry'

const WARM_TIMEOUT_MS = 500

/**
 * Fires a best-effort GET /health to the photos service to trigger a Fly
 * Flycast cold-start before the user picks a file on an editable listing.
 * Fire-and-forget: never throws; errors are silenced after capture.
 */
export function warmPhotosService(): void {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), WARM_TIMEOUT_MS)

	fetch(`${serverEnv.PHOTOS_BASE_URL}/health`, {
		method: 'GET',
		signal: controller.signal,
	})
		.catch((err: unknown) => {
			// AbortError on timeout is expected; other errors are worth knowing about.
			if (err instanceof Error && err.name !== 'AbortError') {
				Sentry.captureException(err)
			}
		})
		.finally(() => clearTimeout(timer))
}
