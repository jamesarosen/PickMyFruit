import { useRouter } from '@tanstack/solid-router'
import { batch, createSignal, For, onCleanup, Show } from 'solid-js'
import { ImagePlus, Loader, Trash } from 'lucide-solid'
import { addPhotoToListing, deletePhoto } from '@/api/listing-photos'
import {
	LISTING_PHOTO_ACCEPT,
	MAX_PHOTOS_PER_LISTING,
	validateListingPhotoFile,
} from '@/lib/listing-photos'
import { Sentry } from '@/lib/sentry'
import { UserError } from '@/lib/user-error'
import type { PublicPhoto } from '@/data/listing'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

const PENDING_DELETE_DELAY_MS = 5000

/** Displays up to 3 listing photos with owner upload/delete controls. */
export default function ListingPhotosSection(props: {
	listingId: number
	photos: PublicPhoto[]
	isOwner: boolean
}) {
	const router = useRouter()
	const [uploading, setUploading] = createSignal(false)
	const [deletingPhotoId, setDeletingPhotoId] = createSignal<string | null>(null)
	const [pendingDeleteId, setPendingDeleteId] = createSignal<string | null>(null)
	const [error, setError] = createErrorSignal()
	const [announcement, setAnnouncement] = createSignal('')
	const [deleteCountdown, setDeleteCountdown] = createSignal(0)
	let pendingDeleteIntervalId: ReturnType<typeof setInterval> | null = null
	let fileInputRef!: HTMLInputElement
	let pendingDeleteTimeoutId: ReturnType<typeof setTimeout> | null = null
	onCleanup(() => {
		if (pendingDeleteTimeoutId !== null) clearTimeout(pendingDeleteTimeoutId)
		if (pendingDeleteIntervalId !== null) clearInterval(pendingDeleteIntervalId)
	})
	const visiblePhotos = () => props.photos.slice(0, MAX_PHOTOS_PER_LISTING)
	const hasReachedLimit = () => visiblePhotos().length >= MAX_PHOTOS_PER_LISTING
	const controlsDisabled = () =>
		uploading() || deletingPhotoId() !== null || pendingDeleteId() !== null

	async function upload() {
		const file = fileInputRef.files?.[0]
		if (!file) {
			return
		}
		if (hasReachedLimit()) {
			setError(new Error('Maximum number of photos reached'))
			return
		}
		const rejectionMessage = validateListingPhotoFile(file)
		if (rejectionMessage) {
			setError(new UserError('INVALID_PHOTO', rejectionMessage))
			fileInputRef.value = ''
			return
		}
		setUploading(true)
		setAnnouncement('Uploading photo…')
		setError(null)
		try {
			const body = new FormData()
			body.append('listingId', String(props.listingId))
			body.append('photo', file)
			await addPhotoToListing({ data: body })
			fileInputRef.value = ''
			setAnnouncement('Photo uploaded')
			await router.invalidate()
		} catch (err) {
			setAnnouncement('')
			if (isOpaqueUploadError(err)) {
				// "Invariant failed" is thrown by TanStack Start's fetcher when the
				// response is missing a content-type header, which happens when a
				// proxy rejects the request (e.g. 413 Payload Too Large with an
				// empty body). Capture to Sentry with file context so we can tell
				// whether users are hitting edge limits, and show a helpful
				// fallback instead of leaking the internal invariant message.
				Sentry.captureException(err, {
					extra: {
						context: 'listing-photo-upload',
						fileName: file.name,
						fileType: file.type,
						fileSize: file.size,
					},
				})
				setError(
					new Error(
						'We couldn’t upload that photo. Please try a smaller JPEG, PNG, or WebP.'
					)
				)
			} else {
				// Server-thrown UserError messages (e.g. INVALID_MIME_TYPE) are
				// already user-safe; surface them as-is.
				setError(err)
			}
		} finally {
			setUploading(false)
		}
	}

	function isOpaqueUploadError(err: unknown): boolean {
		if (err instanceof UserError) return false
		const message = err instanceof Error ? err.message : ''
		return /invariant failed/i.test(message)
	}

	async function removePhoto(photoId: string) {
		setDeletingPhotoId(photoId)
		setError(null)
		try {
			await deletePhoto({ data: { photoId } })
			await router.invalidate()
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
		} finally {
			setDeletingPhotoId(null)
		}
	}

	function startPendingDelete(photoId: string) {
		const totalSeconds = PENDING_DELETE_DELAY_MS / 1000
		setDeleteCountdown(totalSeconds)
		pendingDeleteIntervalId = setInterval(() => {
			setDeleteCountdown((s) => s - 1)
		}, 1000)
		pendingDeleteTimeoutId = setTimeout(() => {
			pendingDeleteTimeoutId = null
			if (pendingDeleteIntervalId !== null) {
				clearInterval(pendingDeleteIntervalId)
				pendingDeleteIntervalId = null
			}
			// batch ensures setPendingDeleteId(null) and setDeletingPhotoId (inside
			// removePhoto) flush in a single render, preventing a visible flash between
			// the two states.
			batch(() => {
				setPendingDeleteId(null)
				void removePhoto(photoId)
			})
		}, PENDING_DELETE_DELAY_MS)
		setPendingDeleteId(photoId)
		setAnnouncement('Deletion pending. Press Cancel within 5 seconds to undo.')
	}

	function cancelPendingDelete() {
		if (pendingDeleteTimeoutId !== null) {
			clearTimeout(pendingDeleteTimeoutId)
			pendingDeleteTimeoutId = null
		}
		if (pendingDeleteIntervalId !== null) {
			clearInterval(pendingDeleteIntervalId)
			pendingDeleteIntervalId = null
		}
		setPendingDeleteId(null)
		setAnnouncement('Deletion cancelled')
	}

	const inputId = `listing-photo-${props.listingId}`

	return (
		<section class="listing-photos-section" aria-label="Listing photos">
			<div aria-live="polite" aria-atomic="true" class="sr-only">
				{announcement()}
			</div>
			<Show
				when={visiblePhotos().length > 0 || (props.isOwner && !hasReachedLimit())}
			>
				<div class="listing-photo-grid">
					<For each={visiblePhotos()}>
						{(photo, index) => (
							<figure
								class="listing-photo-frame"
								classList={{
									'listing-photo-frame--pending-delete': pendingDeleteId() === photo.id,
								}}
							>
								<img
									class="listing-photo"
									src={photo.pubUrl}
									alt={`Listing photo ${index() + 1}`}
									loading="lazy"
									decoding="async"
								/>
								<Show when={props.isOwner}>
									<Show
										when={pendingDeleteId() === photo.id}
										fallback={
											<button
												aria-label={`Remove photo ${index() + 1}`}
												class="listing-photo-remove"
												disabled={controlsDisabled()}
												onClick={() => startPendingDelete(photo.id)}
												type="button"
											>
												<span aria-hidden="true">
													<Trash size={14} />
												</span>
											</button>
										}
									>
										<div class="listing-photo-pending-delete-overlay">
											<p class="listing-photo-pending-label" aria-hidden="true">
												Deleting in {deleteCountdown()}s…
											</p>
											<div
												class="listing-photo-countdown-bar"
												aria-hidden="true"
												style={{
													'--countdown-progress': `${(deleteCountdown() / (PENDING_DELETE_DELAY_MS / 1000)) * 100}%`,
												}}
											/>
											<button
												class="listing-photo-cancel-delete"
												onClick={cancelPendingDelete}
												type="button"
											>
												Cancel
											</button>
										</div>
									</Show>
								</Show>
							</figure>
						)}
					</For>
					<Show when={props.isOwner && !hasReachedLimit()}>
						<label
							class="listing-photo-ghost"
							classList={{
								'listing-photo-ghost--uploading': uploading(),
								'listing-photo-ghost--disabled': controlsDisabled(),
							}}
							for={inputId}
							aria-disabled={controlsDisabled() ? 'true' : undefined}
						>
							<div class="listing-photo-ghost-content">
								<Show
									when={uploading()}
									fallback={<ImagePlus size={40} aria-hidden="true" />}
								>
									<Loader
										size={40}
										class="listing-photo-ghost-spinner"
										aria-hidden="true"
									/>
								</Show>
								<span class="listing-photo-upload-label">Add photo</span>
							</div>
							<input
								accept={LISTING_PHOTO_ACCEPT}
								disabled={controlsDisabled()}
								id={inputId}
								name="photo"
								ref={fileInputRef}
								type="file"
								class="sr-only"
								onChange={() => void upload()}
							/>
						</label>
					</Show>
				</div>
			</Show>
			<ErrorMessage
				class="listing-photo-upload-error"
				defaultMessage="Upload failed"
				error={error()}
			/>
		</section>
	)
}
