import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'

/** Photos older than this threshold are eligible for reconciliation. */
const PENDING_THRESHOLD_MS = 60_000 // 60 s

/** Photos missing from the service for longer than this are abandoned. */
const ABANDON_THRESHOLD_MS = 24 * 60 * 60_000 // 24 h

/** Outcome of reconciling a single photo. */
type PhotoOutcome = 'completed' | 'abandoned' | 'still-pending' | 'error'

/**
 * Scans `pending` photos older than 60 s, checks each against the photos
 * service, and transitions state:
 *   - exists (200) → complete
 *   - missing AND age > 24 h → abandoned
 *   - missing AND age ≤ 24 h → leave as pending (still might be in-flight)
 *
 * The sweep never throws — errors per photo are captured to Sentry and the
 * loop continues for remaining photos.
 */
export async function reconcilePendingPhotos(): Promise<void> {
	const { getPendingPhotosOlderThan, markPhotoComplete, abandonPhoto } =
		await import('@/data/queries.server')
	const { headPhoto } = await import('@/lib/photoServiceClient.server')

	const photos = await getPendingPhotosOlderThan(PENDING_THRESHOLD_MS)

	async function reconcileOne(photo: {
		id: string
		createdAt: Date
	}): Promise<PhotoOutcome> {
		const { exists } = await headPhoto(photo.id)
		if (exists) {
			await markPhotoComplete(photo.id)
			return 'completed'
		}
		const ageMs = Date.now() - photo.createdAt.getTime()
		if (ageMs > ABANDON_THRESHOLD_MS) {
			await abandonPhoto(photo.id)
			return 'abandoned'
		}
		// Age ≤ 24 h and not found: leave as pending (upload may still be in-flight)
		return 'still-pending'
	}

	const results = await Promise.allSettled(photos.map((p) => reconcileOne(p)))

	let completed = 0
	let abandoned = 0
	for (const result of results) {
		if (result.status === 'rejected') {
			Sentry.captureException(result.reason, {
				extra: { photoId: photos[results.indexOf(result)]?.id },
			})
		} else if (result.value === 'completed') {
			completed++
		} else if (result.value === 'abandoned') {
			abandoned++
		}
	}

	logger.info(
		{ pending: photos.length, completed, abandoned },
		'photo reconciliation sweep'
	)
}
