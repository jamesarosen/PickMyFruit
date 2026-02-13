import { createFileRoute, Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import Layout from '@/components/Layout'
import { useSession } from '@/lib/auth-client'
import { getStatusClass } from '@/lib/listing-status'
import { getPublicListingById } from '@/api/listings'
import type { PublicListing } from '@/data/queries'
import '@/routes/listings.css'

export const Route = createFileRoute('/listings/$id')({
	loader: ({ params }) => getPublicListingById({ data: Number(params.id) }),
	component: ListingDetailPage,
})

function ListingDetailPage() {
	const data = Route.useLoaderData()
	const session = useSession()

	const listing = () => data() as PublicListing | undefined
	const isOwner = () => session().data?.user?.id === listing()?.userId

	return (
		<Show
			when={listing()}
			fallback={
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
			}
		>
			{(l) => (
				<Layout title={`${l().name} - Pick My Fruit`}>
					<main class="listing-page">
						<nav class="breadcrumb" aria-label="Breadcrumb">
							<Link to="/">Home</Link>
							<span class="separator" aria-hidden="true">
								/
							</span>
							<span aria-current="page">Listing</span>
						</nav>

						<article class="listing-detail">
							<header class="listing-detail-header">
								<h1>{l().type}</h1>
								<span class={`status-badge ${getStatusClass(l().status)}`}>
									{l().status}
								</span>
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

							<Show when={isOwner()}>
								<div class="listing-owner-notice">
									<p>This is your listing.</p>
									<Link to="/listings/mine" class="back-link">
										Manage My Listings
									</Link>
								</div>
							</Show>
						</article>
					</main>
				</Layout>
			)}
		</Show>
	)
}
