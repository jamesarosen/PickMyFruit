import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import SiteHeader from '@/components/SiteHeader'
import { useSession } from '@/lib/auth-client'
import { authMiddleware } from '@/middleware/auth'
import { getStatusClass } from '@/lib/listing-status'
import type { Listing } from '@/data/schema'
import { getMyListings } from '@/api/listings'
import '@/routes/listings/mine.css'

export const Route = createFileRoute('/listings/mine')({
	loader: () => getMyListings(),
	pendingComponent: () => (
		<Layout title="My Garden - Pick My Fruit">
			<SiteHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main class="page-container">
				<p>Loading…</p>
			</main>
		</Layout>
	),
	component: MyGardenPage,
	server: {
		middleware: [authMiddleware],
	},
})

function ListingCard(props: { listing: Listing }) {
	return (
		<article class="listing-card">
			<Link
				to="/listings/$id"
				params={{ id: String(props.listing.id) }}
				class="listing-card-link"
			>
				<h3>{props.listing.name}</h3>
				<span class={`status-label ${getStatusClass(props.listing.status)}`}>
					{props.listing.status}
				</span>
				<div class="listing-details">
					<p class="listing-location">
						{props.listing.city}, {props.listing.state}
					</p>
					<Show when={props.listing.harvestWindow}>
						<p class="listing-harvest">Harvest: {props.listing.harvestWindow}</p>
					</Show>
				</div>
			</Link>
		</article>
	)
}

function EmptyState() {
	return (
		<div class="empty-state">
			<h2>No listings yet</h2>
			<p>Share your first fruit tree with the community!</p>
			<Link to="/listings/new" class="add-button">
				List My Fruit Tree
			</Link>
		</div>
	)
}

function MyGardenPage() {
	const listings = Route.useLoaderData()
	const session = useSession()
	const search = Route.useSearch()
	const [showMarkedMessage, setShowMarkedMessage] = createSignal(
		() => (search as () => { marked?: string })()?.marked === 'unavailable'
	)

	return (
		<Layout title="My Garden - Pick My Fruit">
			<SiteHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main class="page-container">
				<header class="page-header">
					<h1>My Garden</h1>
					<Show when={session().data?.user}>
						<p>Welcome back, {session().data?.user?.name || 'friend'}!</p>
					</Show>
				</header>

				<Show when={showMarkedMessage()()}>
					<div class="success-message">
						Listing marked as unavailable. Gleaners won't be able to contact you about
						this listing.
						<button
							type="button"
							class="dismiss-button"
							onClick={() => setShowMarkedMessage(() => () => false)}
						>
							Dismiss
						</button>
					</div>
				</Show>

				<Show when={(listings() ?? []).length > 0} fallback={<EmptyState />}>
					<div class="listings-grid">
						<For each={listings()}>
							{(listing) => <ListingCard listing={listing} />}
						</For>
					</div>

					<div class="page-actions">
						<Link to="/listings/new" class="add-button">
							Add Another Tree
						</Link>
					</div>
				</Show>
			</main>
		</Layout>
	)
}
