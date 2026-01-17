import { createFileRoute, Link } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { Show } from 'solid-js'
import Layout from '@/components/Layout'
import InquiryForm from '@/components/InquiryForm'
import { useSession } from '@/lib/auth-client'
import type { Plant } from '@/data/schema'
import '@/routes/listings.css'

const getListing = createIsomorphicFn()
	.server(async ({ params }) => {
		const id = parseInt(params.id, 10)
		if (isNaN(id) || id <= 0) {
			return null
		}

		const { getListingForInquiry } = await import('@/data/queries')
		return getListingForInquiry(id)
	})
	.client(() => undefined)

export const Route = createFileRoute('/listings/$id')({
	loader: (ctx) => getListing(ctx),
	component: ListingDetailPage,
})

function getStatusClass(status: string): string {
	if (status === 'active') {
		return 'status-active'
	}
	if (status === 'unavailable') {
		return 'status-unavailable'
	}
	return 'status-private'
}

function ListingDetailPage() {
	const listing = Route.useLoaderData()
	const session = useSession()
	const params = Route.useParams()

	const plant = listing() as Plant | null | undefined

	if (!plant) {
		return (
			<Layout title="Listing Not Found - Pick My Fruit">
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
		)
	}

	const isOwner = () => session().data?.user?.id === plant.userId
	const canInquire = () =>
		(plant.status === 'active' || plant.status === 'private') && !isOwner()

	return (
		<Layout title={`${plant.type} - Pick My Fruit`}>
			<main class="listing-page">
				<nav class="breadcrumb">
					<Link to="/">Home</Link>
					<span class="separator">/</span>
					<span>Listing</span>
				</nav>

				<article class="listing-detail">
					<header class="listing-detail-header">
						<h1>{plant.type}</h1>
						<span class={`status-badge ${getStatusClass(plant.status)}`}>
							{plant.status}
						</span>
					</header>

					<div class="listing-info">
						<Show when={plant.variety}>
							<div class="info-row">
								<span class="info-label">Variety</span>
								<span class="info-value">{plant.variety}</span>
							</div>
						</Show>

						<Show when={plant.quantity}>
							<div class="info-row">
								<span class="info-label">Quantity</span>
								<span class="info-value">{plant.quantity}</span>
							</div>
						</Show>

						<Show when={plant.harvestWindow}>
							<div class="info-row">
								<span class="info-label">Harvest Window</span>
								<span class="info-value">{plant.harvestWindow}</span>
							</div>
						</Show>

						<div class="info-row">
							<span class="info-label">Location</span>
							<span class="info-value">
								{plant.city}, {plant.state}
							</span>
						</div>

						<Show when={plant.notes}>
							<div class="info-row info-notes">
								<span class="info-label">Notes</span>
								<span class="info-value">{plant.notes}</span>
							</div>
						</Show>
					</div>

					<Show when={plant.status === 'unavailable'}>
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
							<Link to="/garden/mine" class="back-link">
								Manage My Listings
							</Link>
						</div>
					</Show>

					<Show when={canInquire()}>
						<InquiryForm
							listingId={plant.id}
							callbackURL={`/listings/${params().id}`}
						/>
					</Show>
				</article>
			</main>
		</Layout>
	)
}
