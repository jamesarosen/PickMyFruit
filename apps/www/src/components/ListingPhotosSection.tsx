import { useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { LISTING_PHOTO_ACCEPT } from '@/lib/listing-photos'
import { Sentry } from '@/lib/sentry'
import type { PublicPhoto } from '@/data/public-listing'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

const MAX_PHOTOS_PER_LISTING = 3

/** Displays up to 3 listing photos with owner upload/delete controls. */
export default function ListingPhotosSection(props: {
	listingId: number
	photos: PublicPhoto[]
	isOwner: boolean
}) {
	const router = useRouter()
	const [uploading, setUploading] = createSignal(false)
	const [deletingPhotoId, setDeletingPhotoId] = createSignal<number | null>(null)
	const [error, setError] = createErrorSignal()
	let fileInputRef!: HTMLInputElement
	const visiblePhotos = () => props.photos.slice(0, MAX_PHOTOS_PER_LISTING)
	const hasReachedLimit = () => visiblePhotos().length >= MAX_PHOTOS_PER_LISTING
	const controlsDisabled = () => uploading() || deletingPhotoId() !== null

	async function upload() {
		const file = fileInputRef.files?.[0]
		if (!file) {
			setError(new Error('Choose a photo first'))
			return
		}
		if (hasReachedLimit()) {
			setError(new Error('Maximum number of photos reached'))
			return
		}
		setUploading(true)
		setError(null)
		try {
			const body = new FormData()
			body.append('photo', file)
			const res = await fetch(`/api/listings/${props.listingId}/photos`, {
				method: 'POST',
				body,
				credentials: 'same-origin',
			})
			if (!res.ok) {
				let message = 'Upload failed'
				try {
					const data = (await res.json()) as { error?: unknown }
					if (typeof data.error === 'string') {
						message = data.error
					}
				} catch {
					// Response wasn't JSON
				}
				throw new Error(message)
			}
			fileInputRef.value = ''
			await router.invalidate()
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
		} finally {
			setUploading(false)
		}
	}

	async function removePhoto(photoId: number) {
		setDeletingPhotoId(photoId)
		setError(null)
		try {
			const res = await fetch(
				`/api/listings/${props.listingId}/photos/${photoId}`,
				{
					method: 'DELETE',
					credentials: 'same-origin',
				}
			)
			if (!res.ok) {
				let message = 'Failed to remove photo'
				try {
					const data = (await res.json()) as { error?: unknown }
					if (typeof data.error === 'string') {
						message = data.error
					}
				} catch {
					// Response wasn't JSON
				}
				throw new Error(message)
			}
			await router.invalidate()
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
		} finally {
			setDeletingPhotoId(null)
		}
	}

	const inputId = `listing-photo-${props.listingId}`

	return (
		<section class="listing-photos-section" aria-label="Listing photos">
			<Show
				when={visiblePhotos().length > 0 || (props.isOwner && !hasReachedLimit())}
			>
				<div class="listing-photo-grid">
					<For each={visiblePhotos()}>
						{(photo, index) => (
							<figure class="listing-photo-frame">
								<img
									class="listing-photo"
									src={photo.pubUrl}
									alt={`Listing photo ${index() + 1}`}
									loading="lazy"
									decoding="async"
								/>
								<Show when={props.isOwner}>
									<button
										aria-label={`Remove photo ${index() + 1}`}
										class="listing-photo-remove"
										disabled={controlsDisabled()}
										onClick={() => void removePhoto(photo.id)}
										type="button"
									>
										<span aria-hidden="true">X</span>
									</button>
								</Show>
							</figure>
						)}
					</For>
					<Show when={props.isOwner && !hasReachedLimit()}>
						<div class="listing-photo-ghost">
							<div class="listing-photo-ghost-content">
								<label class="listing-photo-upload-label" for={inputId}>
									Add photo
								</label>
								<input
									accept={LISTING_PHOTO_ACCEPT}
									disabled={controlsDisabled() || hasReachedLimit()}
									id={inputId}
									name="photo"
									ref={fileInputRef}
									type="file"
								/>
								<button
									disabled={controlsDisabled() || hasReachedLimit()}
									onClick={() => void upload()}
									type="button"
								>
									{uploading() ? 'Uploading…' : 'Upload'}
								</button>
							</div>
						</div>
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
