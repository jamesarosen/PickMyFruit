import { createFileRoute, Link, useRouteContext } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingCard from '@/components/ListingCard'
import { authMiddleware } from '@/middleware/auth'
import { getMyListings } from '@/api/listings'
import { displayName } from '@/lib/display-name'
import '@/routes/listings/mine.css'

export const Route = createFileRoute('/listings/mine')({
	loader: () => getMyListings(),
	pendingComponent: () => (
		<Layout title="My Garden - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main id="main-content" class="listings-mine">
				<p>Loading…</p>
			</main>
		</Layout>
	),
	component: MyGardenPage,
	server: {
		middleware: [authMiddleware],
	},
})

function EmptyState() {
	return (
		<div class="empty-state">
			<h2>No listings yet</h2>
			<p>Share something from your garden with the community!</p>
			<Link to="/listings/new" class="button button--primary">
				Add a Listing
			</Link>
		</div>
	)
}

function MyGardenPage() {
	const listings = Route.useLoaderData()
	const context = useRouteContext({ from: '__root__' })

	return (
		<Layout title="My Garden - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main id="main-content" class="listings-mine">
				<header class="my-garden-header">
					<h1>My Garden</h1>
					<Show when={context().session?.user}>
						{(user) => <p>Welcome back, {displayName(user())}!</p>}
					</Show>
				</header>

				<Show when={(listings() ?? []).length > 0} fallback={<EmptyState />}>
					<div class="listings-grid">
						<For each={listings()}>
							{(listing) => <ListingCard listing={listing} />}
						</For>
					</div>

					<div class="page-actions">
						<Link to="/listings/new" class="button button--primary">
							Add Another Tree
						</Link>
					</div>
				</Show>
			</main>
		</Layout>
	)
}
