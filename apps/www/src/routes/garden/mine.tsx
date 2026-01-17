import { createFileRoute, Link } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import { createSignal, For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import { useSession } from '@/lib/auth-client'
import { authMiddleware } from '@/middleware/auth'
import type { Listing } from '@/data/schema'
import '@/routes/garden/mine.css'
import { getRequest } from '@tanstack/solid-start/server'

const getMyListings = createIsomorphicFn()
	.server(async () => {
		const { headers } = await getRequest()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return [] as Listing[]
		}

		const { getUserListings } = await import('@/data/queries')
		return getUserListings(session.user.id)
	})
	.client(() => undefined)

export const Route = createFileRoute('/garden/mine')({
	loader: getMyListings,
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

function getStatusClass(status: string): string {
	if (status === 'active') {
		return 'status-active'
	}
	if (status === 'unavailable') {
		return 'status-unavailable'
	}
	if (status === 'private') {
		return 'status-private'
	}
	// Legacy support
	if (status === 'available') {
		return 'status-active'
	}
	return 'status-unavailable'
}

function getToggleButtonText(isToggling: boolean, status: string): string {
	if (isToggling) {
		return 'Updating...'
	}
	if (status === 'active') {
		return 'Mark Unavailable'
	}
	return 'Mark Active'
}

function ListingCard(props: { listing: Listing; onStatusChange: () => void }) {
	const { listing } = props
	const [isToggling, setIsToggling] = createSignal(false)
	const [currentStatus, setCurrentStatus] = createSignal(listing.status)
	const [error, setError] = createSignal<string | null>(null)

	const statusClass = () => getStatusClass(currentStatus())
	const displayStatus = () => {
		const s = currentStatus()
		// Show user-friendly status (map legacy values)
		if (s === 'available') {
			return 'active'
		}
		return s
	}

	async function toggleStatus() {
		const newStatus = currentStatus() === 'active' ? 'unavailable' : 'active'
		setIsToggling(true)
		setError(null)

		try {
			const response = await fetch(`/api/listings/${listing.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: newStatus }),
			})

			if (!response.ok) {
				const data = await response.json()
				throw new Error(data.error || 'Failed to update status')
			}

			setCurrentStatus(newStatus)
			props.onStatusChange()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update')
		} finally {
			setIsToggling(false)
		}
	}

	return (
		<article class="listing-card">
			<div class="listing-header">
				<h3>{listing.name}</h3>
				<span class={`status-badge ${statusClass()}`}>{displayStatus()}</span>
			</div>
			<div class="listing-details">
				<p class="listing-location">
					{listing.city}, {listing.state}
				</p>
				<Show when={listing.harvestWindow}>
					<p class="listing-harvest">Harvest: {listing.harvestWindow}</p>
				</Show>
			</div>
			<Show when={error()}>
				<p class="listing-error">{error()}</p>
			</Show>
			<div class="listing-actions">
				<button
					type="button"
					class="status-toggle-button"
					onClick={toggleStatus}
					disabled={isToggling()}
				>
					{getToggleButtonText(isToggling(), currentStatus())}
				</button>
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
	const search = Route.useSearch()
	const [showMarkedMessage, setShowMarkedMessage] = createSignal(
		() => (search as () => { marked?: string })()?.marked === 'unavailable'
	)

	function handleStatusChange() {
		// Could trigger a re-fetch here if needed
	}

	return (
		<Layout title="My Garden - Pick My Fruit">
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
							{(listing) => (
								<ListingCard listing={listing} onStatusChange={handleStatusChange} />
							)}
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
