import { useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { ImagePlus, Loader, Trash } from 'lucide-solid'
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
		if (!file) return
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
			<div aria-live="polite" aria-atomic="true" class="sr-only">
				<Show when={uploading()}>Uploading photo…</Show>
			</div>
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
										<span aria-hidden="true">
											<Trash size={14} />
										</span>
									</button>
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
								class="listing-photo-file-input"
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
