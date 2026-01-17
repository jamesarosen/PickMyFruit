import { createFileRoute, Link } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import { useSession } from '@/lib/auth-client'
import { requireAuth } from '@/lib/require-auth'
import type { Plant } from '@/data/schema'
import '@/routes/garden/mine.css'

const getMyListings = createIsomorphicFn()
	.server(async ({ context }) => {
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({
			headers: context.request.headers,
		})
		if (!session?.user) {
			return [] as Plant[]
		}

		const { getUserListings } = await import('@/data/queries')
		return getUserListings(session.user.id)
	})
	.client(() => undefined)

export const Route = createFileRoute('/garden/mine')({
	beforeLoad: ({ context }) => requireAuth(context),
	loader: (ctx) => getMyListings(ctx),
	pendingComponent: () => (
		<Layout title="My Garden - Pick My Fruit">
			<main class="page-container">
				<p>Loading…</p>
			</main>
		</Layout>
	),
	component: MyGardenPage,
})

function getStatusClass(status: string): string {
	if (status === 'available') {
		return 'status-available'
	}
	if (status === 'claimed') {
		return 'status-claimed'
	}
	return 'status-harvested'
}

function ListingCard(props: { listing: Plant }) {
	const { listing } = props
	const statusClass = getStatusClass(listing.status)

	return (
		<article class="listing-card">
			<div class="listing-header">
				<h3>{listing.name}</h3>
				<span class={`status-badge ${statusClass}`}>{listing.status}</span>
			</div>
			<div class="listing-details">
				<p class="listing-location">
					{listing.city}, {listing.state}
				</p>
				<Show when={listing.harvestWindow}>
					<p class="listing-harvest">Harvest: {listing.harvestWindow}</p>
				</Show>
			</div>
			<div class="listing-actions">
				<button type="button" class="edit-button" disabled>
					Edit
				</button>
			</div>
		</article>
	)
}

function EmptyState() {
	return (
		<div class="empty-state">
			<h2>No listings yet</h2>
			<p>Share your first fruit tree with the community!</p>
			<Link to="/garden/new" class="add-button">
				List My Fruit Tree
			</Link>
		</div>
	)
}

function MyGardenPage() {
	const listings = Route.useLoaderData()
	const session = useSession()

	return (
		<Layout title="My Garden - Pick My Fruit">
			<main class="page-container">
				<header class="page-header">
					<h1>My Garden</h1>
					<Show when={session().data?.user}>
						<p>Welcome back, {session().data?.user?.name || 'friend'}!</p>
					</Show>
				</header>

				<Show when={(listings() ?? []).length > 0} fallback={<EmptyState />}>
					<div class="listings-grid">
						<For each={listings()}>
							{(listing) => <ListingCard listing={listing} />}
						</For>
					</div>

					<div class="page-actions">
						<Link to="/garden/new" class="add-button">
							Add Another Tree
						</Link>
					</div>
				</Show>
			</main>
		</Layout>
	)
}
