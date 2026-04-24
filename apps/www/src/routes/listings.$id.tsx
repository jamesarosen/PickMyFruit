import { createFileRoute, Link, useRouteContext } from '@tanstack/solid-router'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import Banner from '@/components/Banner'
import InquiryForm from '@/components/InquiryForm'
import ListingMap from '@/components/ListingMap'
import ListingPhotosSection from '@/components/ListingPhotosSection'
import {
	getStatusClass,
	VISIBILITY_OPTIONS,
	statusSemanticColor,
} from '@/lib/listing-status'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'
import { buildListingMeta } from '@/lib/listing-meta'
import { Sentry } from '@/lib/sentry'
import { getListingForViewer } from '@/api/listings'
import type { Listing } from '@/data/schema'
import type { PublicListing } from '@/data/queries.server'
import type { OwnerListingView, PublicPhoto } from '@/data/listing'
import '@/routes/listing-show.css'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

const listingSearchSchema = z.object({
	created: z.boolean().optional(),
	marked: z.enum(['unavailable']).optional(),
})

/**
 * Fallback embed image used when a listing has no cover photo. Matches the
 * `<Apple />` placeholder shown on `ListingCard` so the crawler preview and
 * the in-app card feel visually consistent. Served from `public/`.
 */
const PLACEHOLDER_EMBED = {
	url: '/og-listing-placeholder.png',
	width: '1200',
	height: '630',
	alt: 'Pick My Fruit listing',
}

export const Route = createFileRoute('/listings/$id')({
	validateSearch: listingSearchSchema,
	loader: ({ params }) => getListingForViewer({ data: Number(params.id) }),
	head: ({ loaderData }) => {
		// TODO: generate richer embed images for listings. Open Graph / Twitter /
		// Slack crawlers prefer different aspect ratios and resolutions (e.g.
		// 1200x630 landscape for large cards, 1:1 square for summary cards, plus
		// higher-density variants). We should:
		//   - serve multiple renditions per photo (small/large, landscape/square),
		//   - auto-focus the subject (object-fit / smart crop) so fruit stays in
		//     frame across aspect ratios,
		//   - emit og:image:width / og:image:height matching the served rendition.
		// For now we reuse the existing public JPEG URL, which is good enough for
		// most crawlers but ignores the above nuances.
		const coverUrl = coverPhotoUrl(loaderData)
		const textMeta = buildListingMeta(loaderData)
		const imageMeta = coverUrl
			? [
					{ property: 'og:image', content: coverUrl },
					{ name: 'twitter:image', content: coverUrl },
				]
			: [
					{ property: 'og:image', content: PLACEHOLDER_EMBED.url },
					{ property: 'og:image:width', content: PLACEHOLDER_EMBED.width },
					{ property: 'og:image:height', content: PLACEHOLDER_EMBED.height },
					{ property: 'og:image:alt', content: PLACEHOLDER_EMBED.alt },
					{ name: 'twitter:image', content: PLACEHOLDER_EMBED.url },
				]

		if (!textMeta) {
			return { meta: imageMeta }
		}

		return {
			meta: [
				{ title: `${textMeta.title} - Pick My Fruit` },
				{ name: 'description', content: textMeta.description },
				{ property: 'og:title', content: textMeta.title },
				{ property: 'og:description', content: textMeta.description },
				{ name: 'twitter:title', content: textMeta.title },
				{ name: 'twitter:description', content: textMeta.description },
				...imageMeta,
			],
		}
	},
	component: ListingDetailPage,
})

/**
 * Returns the public URL of the listing's cover photo, or undefined if the
 * listing has no photos. Relies on the data-layer invariant that `photos` is
 * sorted by `order` ascending, so `photos[0]` is the cover photo.
 */
function coverPhotoUrl(
	row: Listing | PublicListing | OwnerListingView | undefined
): string | undefined {
	if (!row || !('photos' in row)) {
		return undefined
	}
	return row.photos[0]?.pubUrl
}

const STATUS_DEBOUNCE_MS = 300

function photosForViewerRow(
	row: Listing | PublicListing | OwnerListingView
): PublicPhoto[] {
	return 'photos' in row ? row.photos : []
}

function OwnerControls(props: {
	listingId: number
	initialStatus: ListingStatusValue
}) {
	const [isUpdating, setIsUpdating] = createSignal(false)
	const [savedStatus, setSavedStatus] = createSignal(props.initialStatus)
	const [displayStatus, setDisplayStatus] = createSignal(props.initialStatus)
	const [error, setError] = createErrorSignal()
	let debounceTimer: ReturnType<typeof setTimeout> | undefined

	onCleanup(() => clearTimeout(debounceTimer))

	function selectStatus(newStatus: ListingStatusValue) {
		if (newStatus === displayStatus()) {
			return
		}
		setDisplayStatus(newStatus)
		setError(null)
		clearTimeout(debounceTimer)
		debounceTimer = setTimeout(() => commitStatus(newStatus), STATUS_DEBOUNCE_MS)
	}

	async function commitStatus(newStatus: ListingStatusValue) {
		if (newStatus === savedStatus()) {
			return
		}
		setIsUpdating(true)

		try {
			const response = await fetch(`/api/listings/${props.listingId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus }),
			})

			if (!response.ok) {
				let message = 'Failed to update status'
				try {
					const data = await response.json()
					message = typeof data.error === 'string' ? data.error : message
				} catch {
					// Response wasn't JSON
				}
				throw new Error(message)
			}

			setSavedStatus(newStatus)
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
			setDisplayStatus(savedStatus())
		} finally {
			setIsUpdating(false)
		}
	}

	return (
		<>
			<fieldset class="visibility-fieldset" aria-busy={isUpdating()}>
				<legend class="visibility-legend">Visibility</legend>
				<For each={VISIBILITY_OPTIONS}>
					{(option) => (
						<label
							class="visibility-option"
							classList={{
								'visibility-option--selected': displayStatus() === option.value,
							}}
							style={{
								'--visibility-color': statusSemanticColor[option.value],
							}}
						>
							<input
								type="radio"
								name="visibility"
								value={option.value}
								checked={displayStatus() === option.value}
								onChange={() => selectStatus(option.value)}
							/>
							<span class="visibility-option-text">
								<span class="visibility-option-label">{option.label}</span>
								<span class="visibility-option-description">{option.description}</span>
							</span>
						</label>
					)}
				</For>
				<ErrorMessage
					class="visibility-error"
					defaultMessage="Failed to update"
					error={error()}
				/>
			</fieldset>
		</>
	)
}

function ListingDetailPage() {
	const data = Route.useLoaderData()
	const context = useRouteContext({ from: '__root__' })
	const params = Route.useParams()
	const search = Route.useSearch()

	const listing = () =>
		data() as Listing | PublicListing | OwnerListingView | undefined
	// OwnerListingView includes userId; PublicListing does not.
	const isOwner = () => {
		const l = listing()
		return !!l && 'userId' in l && context().session?.user?.id === l.userId
	}
	const justCreated = () => search().created === true
	const justMarkedUnavailable = () => search().marked === 'unavailable'
	const canInquire = () => {
		const l = listing()
		return l && l.status === ListingStatus.available && !isOwner()
	}

	return (
		<Show
			when={listing()}
			fallback={
				<Layout title="Listing Not Found - Pick My Fruit">
					<PageHeader breadcrumbs={[{ label: 'Listing' }]} />
					<main id="main-content" class="listing-show">
						<div class="listing-not-found">
							<h1>Listing Not Found</h1>
							<p>This listing may have been removed or doesn't exist.</p>
							<Link to="/" class="back-link">
								Back to Home
							</Link>
						</div>
					</main>
				</Layout>
			}
		>
			{(l) => (
				<Layout title={`${l().name} - Pick My Fruit`}>
					<PageHeader breadcrumbs={[{ label: l().name }]} />
					<main id="main-content" class="listing-show">
						<Show when={justCreated() && isOwner()}>
							<Banner variant="success" dismissible>
								Your fruit is listed! Share it with your neighbors.
							</Banner>
						</Show>
						<Show when={justMarkedUnavailable() && isOwner()}>
							<Banner variant="success" dismissible>
								Listing marked as unavailable. Gleaners won't be able to contact you
								about this listing.
							</Banner>
						</Show>
						<article class="listing-detail">
							<header class="listing-detail-header">
								<h1>{l().type}</h1>
								<Show
									when={isOwner()}
									fallback={
										<span class={`status-badge ${getStatusClass(l().status)}`}>
											{l().status}
										</span>
									}
								>
									<OwnerControls
										listingId={l().id}
										initialStatus={l().status as ListingStatusValue}
									/>
								</Show>
							</header>

							<ListingPhotosSection
								isOwner={isOwner()}
								listingId={l().id}
								photos={photosForViewerRow(l())}
							/>

							<div class="listing-info">
								<Show when={l().variety}>
									<div class="info-row">
										<span class="info-label">Variety</span>
										<span class="info-value">{l().variety}</span>
									</div>
								</Show>

								<Show when={l().quantity}>
									<div class="info-row">
										<span class="info-label">Quantity</span>
										<span class="info-value">{l().quantity}</span>
									</div>
								</Show>

								<Show when={l().harvestWindow}>
									<div class="info-row">
										<span class="info-label">Harvest Window</span>
										<span class="info-value">{l().harvestWindow}</span>
									</div>
								</Show>

								<div class="info-row">
									<span class="info-label">Location</span>
									<span class="info-value">
										{l().city}, {l().state}
									</span>
								</div>

								<Show when={l().notes}>
									<div class="info-row info-notes">
										<span class="info-label">Notes</span>
										<span class="info-value">{l().notes}</span>
									</div>
								</Show>
							</div>

							<div class="listing-map-section">
								<Show
									when={isOwner() && 'lat' in l() ? (l() as Listing) : undefined}
									fallback={
										<Show
											when={
												'approximateH3Index' in l() ? (l() as PublicListing) : undefined
											}
										>
											{(pub) => (
												<ListingMap
													mode="public"
													approximateH3Index={pub().approximateH3Index}
												/>
											)}
										</Show>
									}
								>
									{(owner) => (
										<ListingMap
											mode="owner"
											lat={owner().lat}
											lng={owner().lng}
											h3Index={owner().h3Index}
										/>
									)}
								</Show>
							</div>

							<Show when={l().status === ListingStatus.unavailable}>
								<div class="listing-unavailable">
									<h3>This listing is currently unavailable</h3>
									<p>Check back later or browse other available listings.</p>
									<Link to="/" class="back-link">
										Browse Available Listings
									</Link>
								</div>
							</Show>

							<Show when={isOwner()}>
								<div class="listing-owner-notice">
									<p>This is your listing.</p>
									<Link to="/listings/mine" class="back-link">
										Manage My Listings
									</Link>
								</div>
							</Show>

							<Show when={canInquire()}>
								<InquiryForm
									listingId={l().id}
									listingType={l().type}
									callbackURL={`/listings/${params().id}`}
								/>
							</Show>
						</article>
					</main>
				</Layout>
			)}
		</Show>
	)
}
