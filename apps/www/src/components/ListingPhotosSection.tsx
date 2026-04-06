import { useRouter } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { LISTING_PHOTO_ACCEPT } from '@/lib/listing-photos'
import { Sentry } from '@/lib/sentry'
import type { PublicPhoto } from '@/data/public-listing'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

/** First listing photo and owner upload controls (MVP: single visible image). */
export default function ListingPhotosSection(props: {
	listingId: number
	photos: PublicPhoto[]
	isOwner: boolean
}) {
	const router = useRouter()
	const [uploading, setUploading] = createSignal(false)
	const [error, setError] = createErrorSignal()
	let fileInputRef!: HTMLInputElement

	async function upload() {
		const file = fileInputRef.files?.[0]
		if (!file) {
			setError(new Error('Choose a photo first'))
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

	const inputId = `listing-photo-${props.listingId}`

	return (
		<section class="listing-photos-section" aria-label="Listing photos">
			<Show when={props.photos[0]}>
				{(photo) => (
					<img
						class="listing-photo"
						src={photo().pubUrl}
						alt="Listing photo"
						loading="lazy"
						decoding="async"
					/>
				)}
			</Show>
			<Show when={props.isOwner}>
				<div class="listing-photo-upload">
					<label class="listing-photo-upload-label" for={inputId}>
						Add photos
					</label>
					<input
						accept={LISTING_PHOTO_ACCEPT}
						disabled={uploading()}
						id={inputId}
						name="photo"
						ref={fileInputRef}
						type="file"
					/>
					<button disabled={uploading()} onClick={() => void upload()} type="button">
						{uploading() ? 'Uploading…' : 'Upload'}
					</button>
					<ErrorMessage
						class="listing-photo-upload-error"
						defaultMessage="Upload failed"
						error={error()}
					/>
				</div>
			</Show>
		</section>
	)
}
