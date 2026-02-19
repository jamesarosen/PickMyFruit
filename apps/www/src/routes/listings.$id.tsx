import { createFileRoute, Link, useRouteContext } from '@tanstack/solid-router'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import SiteHeader from '@/components/SiteHeader'
import Banner from '@/components/Banner'
import InquiryForm from '@/components/InquiryForm'
import {
	getStatusClass,
	VISIBILITY_OPTIONS,
	statusSemanticColor,
} from '@/lib/listing-status'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'
import { Sentry } from '@/lib/sentry'
import { getListingForViewer } from '@/api/listings'
import type { Listing } from '@/data/schema'
import type { PublicListing } from '@/data/queries'
import '@/routes/listings.css'

const listingSearchSchema = z.object({
	created: z.boolean().optional(),
	marked: z.enum(['unavailable']).optional(),
})

export const Route = createFileRoute('/listings/$id')({
	validateSearch: listingSearchSchema,
	loader: ({ params }) => getListingForViewer({ data: Number(params.id) }),
	component: ListingDetailPage,
})

const STATUS_DEBOUNCE_MS = 300

function OwnerControls(props: {
	listingId: number
	initialStatus: ListingStatusValue
}) {
	const [isUpdating, setIsUpdating] = createSignal(false)
	const [savedStatus, setSavedStatus] = createSignal(props.initialStatus)
	const [displayStatus, setDisplayStatus] = createSignal(props.initialStatus)
	const [error, setError] = createSignal<string | null>(null)
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
			setError(err instanceof Error ? err.message : 'Failed to update')
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
			</fieldset>
			<Show when={error()}>
				<p class="visibility-error">{error()}</p>
			</Show>
		</>
	)
}

function ListingDetailPage() {
	const data = Route.useLoaderData()
	const context = useRouteContext({ from: '__root__' })
	const params = Route.useParams()
	const search = Route.useSearch()

	const listing = () => data() as Listing | PublicListing | undefined
	const isOwner = () => context().session?.user?.id === listing()?.userId
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
					<SiteHeader breadcrumbs={[{ label: 'Listing' }]} />
					<main class="listing-page">
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
					<SiteHeader breadcrumbs={[{ label: l().name }]} />
					<main class="listing-page">
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
