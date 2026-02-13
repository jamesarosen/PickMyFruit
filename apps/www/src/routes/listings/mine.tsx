import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import { useSession } from '@/lib/auth-client'
import { authMiddleware } from '@/middleware/auth'
import { getStatusClass } from '@/lib/listing-status'
import { ListingStatus } from '@/lib/validation'
import { Sentry } from '@/lib/sentry'
import type { Listing } from '@/data/schema'
import { getMyListings } from '@/api/listings'
import '@/routes/listings/mine.css'

export const Route = createFileRoute('/listings/mine')({
	loader: () => getMyListings(),
	pendingComponent: () => (
		<Layout title="My Garden - Pick My Fruit">
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

function getToggleButtonText(isToggling: boolean, status: string): string {
	if (isToggling) {
		return 'Updating...'
	}
	if (status === ListingStatus.available) {
		return 'Mark Unavailable'
	}
	return 'Mark Available'
}

function ListingCard(props: { listing: Listing }) {
	const [isToggling, setIsToggling] = createSignal(false)
	const [currentStatus, setCurrentStatus] = createSignal(props.listing.status)
	const [error, setError] = createSignal<string | null>(null)

	const statusClass = () => getStatusClass(currentStatus())
	const isToggleable = () => currentStatus() !== ListingStatus.private

	async function toggleStatus() {
		const newStatus =
			currentStatus() === ListingStatus.available
				? ListingStatus.unavailable
				: ListingStatus.available
		setIsToggling(true)
		setError(null)

		try {
			const response = await fetch(`/api/listings/${props.listing.id}`, {
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

			setCurrentStatus(newStatus)
		} catch (err) {
			Sentry.captureException(err)
			setError(err instanceof Error ? err.message : 'Failed to update')
		} finally {
			setIsToggling(false)
		}
	}

	return (
		<article class="listing-card">
			<div class="listing-header">
				<h3>{props.listing.name}</h3>
				<span class={`status-badge ${statusClass()}`}>{currentStatus()}</span>
			</div>
			<div class="listing-details">
				<p class="listing-location">
					{props.listing.city}, {props.listing.state}
				</p>
				<Show when={props.listing.harvestWindow}>
					<p class="listing-harvest">Harvest: {props.listing.harvestWindow}</p>
				</Show>
			</div>
			<Show when={error()}>
				<p class="listing-error">{error()}</p>
			</Show>
			<div class="listing-actions">
				<Show when={isToggleable()}>
					<button
						type="button"
						class="status-toggle-button"
						onClick={toggleStatus}
						disabled={isToggling()}
					>
						{getToggleButtonText(isToggling(), currentStatus())}
					</button>
				</Show>
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
			<Link to="/listings/new" class="add-button">
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
						<Link to="/listings/new" class="add-button">
							Add Another Tree
						</Link>
					</div>
				</Show>
			</main>
		</Layout>
	)
}
