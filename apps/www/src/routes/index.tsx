import { createFileRoute, Link } from '@tanstack/solid-router'
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from 'solid-js'
import { z } from 'zod'
import { cellToLatLng } from 'h3-js'
import { milesTo, plural } from '@/lib/distance'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingsMap from '@/components/ListingsMap'
import ListingCard from '@/components/ListingCard'
import ListingGridCta from '@/components/ListingGridCta'
import Locate from 'lucide-solid/icons/locate'
import { getNearestListings, getListingsInViewport } from '@/api/listings'
import { Sentry } from '@/lib/sentry'
import type { PublicListing } from '@/data/listing'
import type { ViewportBounds } from '@/lib/h3-viewport'
import {
	NAPA_CITY_HALL,
	requestCurrentLocation,
	type LocationBias,
} from '@/lib/geolocation'
import '@/routes/index.css'

const homeSearchSchema = z.object({
	// A shareable / deep-linkable map center. The loader frames the grid around
	// it for a deterministic, crawlable first paint; live panning refines client
	// side without rewriting the URL.
	lat: z.number().optional(),
	lng: z.number().optional(),
	z: z.number().optional(),
})

export const Route = createFileRoute('/')({
	validateSearch: homeSearchSchema,
	loaderDeps: ({ search }) => ({ lat: search.lat, lng: search.lng }),
	loader: ({ deps }) =>
		getNearestListings({
			data: {
				lat: deps.lat ?? NAPA_CITY_HALL.lat,
				lng: deps.lng ?? NAPA_CITY_HALL.lng,
			},
		}),
	component: HomePage,
})

/** How the listings grid is currently sourced. */
type GridMode = 'initial' | 'in-view' | 'empty'

function HomePage() {
	const initialNearest = Route.useLoaderData()
	const search = Route.useSearch()

	// The map centers on the URL point when present (a shared link / deep link),
	// otherwise it frames the loader's nearest listings. A fresh object also
	// re-triggers the map's recenter effect for "Center" and "Jump to nearest".
	const initialCenter = (): LocationBias | null => {
		const s = search()
		return s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null
	}
	const [mapCenter, setMapCenter] = createSignal<LocationBias | null>(
		initialCenter()
	)
	const [locating, setLocating] = createSignal(false)

	// `null` until the first user-driven viewport query — until then the grid
	// shows the loader's nearest listings (the SSR first paint).
	const [viewportListings, setViewportListings] = createSignal<
		PublicListing[] | null
	>(null)
	// Nearest listings to wherever the user is looking, shown when the viewport
	// itself is empty so the page never dead-ends.
	const [fallbackNearest, setFallbackNearest] =
		createSignal<PublicListing[]>(initialNearest())
	const [fallbackCenter, setFallbackCenter] = createSignal<LocationBias>(
		initialCenter() ?? NAPA_CITY_HALL
	)
	const [updating, setUpdating] = createSignal(false)

	// A monotonically increasing id; only the latest in-flight request may write
	// state, so fast panning settles on the final viewport, not a stale one.
	let requestSeq = 0

	async function handleViewportChange(bounds: ViewportBounds) {
		const seq = ++requestSeq
		setUpdating(true)
		try {
			const inView = await getListingsInViewport({ data: bounds })
			if (seq !== requestSeq) return
			setViewportListings(inView)
			if (inView.length === 0) {
				const center = {
					lat: (bounds.north + bounds.south) / 2,
					lng: (bounds.east + bounds.west) / 2,
				}
				const near = await getNearestListings({
					data: { lat: center.lat, lng: center.lng },
				})
				if (seq !== requestSeq) return
				setFallbackNearest(near)
				setFallbackCenter(center)
			}
		} catch (error) {
			// A failed refresh leaves the prior results in place rather than wedging
			// the grid; the next settle retries.
			Sentry.captureException(error)
		} finally {
			if (seq === requestSeq) setUpdating(false)
		}
	}

	const mode = createMemo<GridMode>(() => {
		const vp = viewportListings()
		if (vp === null) return 'initial'
		return vp.length > 0 ? 'in-view' : 'empty'
	})

	// Listings the map should render markers for. In the empty state these are
	// the (off-screen) nearest listings, so their pins exist if the user pans.
	const mapListings = createMemo<PublicListing[]>(() => {
		switch (mode()) {
			case 'in-view':
				return viewportListings() ?? []
			case 'empty':
				return fallbackNearest()
			default:
				return initialNearest()
		}
	})

	// Cards shown in the main grid (initial + in-view modes). The empty mode
	// renders its own block plus a separate "Nearest listings" section.
	const gridListings = createMemo<PublicListing[]>(() =>
		mode() === 'in-view' ? (viewportListings() ?? []) : initialNearest()
	)

	const nearestTarget = createMemo(() => fallbackNearest()[0])

	const jumpLabel = createMemo(() => {
		const target = nearestTarget()
		if (!target) return 'See nearest listings'
		return `Jump to nearest — ${target.city}, ${milesTo(target, fallbackCenter())}`
	})

	function jumpToNearest() {
		const target = nearestTarget()
		if (!target) return
		const [lat, lng] = cellToLatLng(target.approximateH3Index)
		setMapCenter({ lat, lng })
	}

	async function centerOnMyLocation() {
		if (locating()) return
		setLocating(true)
		try {
			const position = await requestCurrentLocation()
			if (position) setMapCenter({ ...position })
		} finally {
			setLocating(false)
		}
	}

	// Politely announce result changes to assistive tech, encoding the mode so a
	// non-sighted user can tell in-view results from the nearest fallback.
	const liveSummary = createMemo(() => {
		switch (mode()) {
			case 'in-view': {
				const n = viewportListings()?.length ?? 0
				return `${n} ${plural(n, 'listing')} in this area.`
			}
			case 'empty': {
				const target = nearestTarget()
				const n = fallbackNearest().length
				return target
					? `No listings in this view; showing ${n} nearest, closest in ${target.city}.`
					: 'No listings in this view.'
			}
			default: {
				const n = initialNearest().length
				return `${n} ${plural(n, 'listing')} near you.`
			}
		}
	})

	// Delay the "Updating…" hint so quick (cached or fast) responses never flash
	// it; only a genuinely slow fetch surfaces it.
	const [showUpdating, setShowUpdating] = createSignal(false)
	createEffect(() => {
		if (!updating()) {
			setShowUpdating(false)
			return
		}
		const timer = setTimeout(() => setShowUpdating(true), 350)
		onCleanup(() => clearTimeout(timer))
	})

	return (
		<Layout title="Pick My Fruit - Turn your backyard abundance into community food">
			<div class="home-page">
				<PageHeader />

				<main id="main-content">
					<section class="hero surface-subtle">
						<div class="container">
							<h1>Stop Watching Your Fruit Rot</h1>
							<p class="hero-subtitle">
								Turn your backyard abundance into community food.
								<br />
								We connect you with neighbors who will use your produce.
								<br />
								Rooted in Napa. Growing everywhere.
							</p>
							<Link to="/listings/new" class="button button--primary button--lg">
								Share What I'm Growing
							</Link>
						</div>
					</section>

					<section class="how-it-works">
						<div class="container">
							<h2>How It Works</h2>
							<div class="steps">
								<div class="step">
									<div class="step-number">1</div>
									<h3>Tell us about your produce</h3>
									<p>Takes 30 seconds</p>
								</div>
								<div class="step">
									<div class="step-number">2</div>
									<h3>Neighbors find your listing</h3>
									<p>You get an email when someone wants to pick</p>
								</div>
								<div class="step">
									<div class="step-number">3</div>
									<h3>They pick (or pick up), you relax</h3>
									<p>Surplus feeds families</p>
								</div>
							</div>
							<Link to="/listings/new" class="button button--primary button--lg">
								Add a Listing
							</Link>
						</div>
					</section>

					<section class="available-listings">
						<div class="container">
							<div class="available-listings__header">
								<h2>Available Now</h2>
								<button
									type="button"
									class="available-listings__center"
									onClick={centerOnMyLocation}
									disabled={locating()}
									title="Center map on my location"
									aria-label="Center map on my location"
								>
									<Locate aria-hidden="true" />
								</button>
							</div>

							<ListingsMap
								listings={mapListings()}
								center={mapCenter()}
								onViewportChange={handleViewportChange}
							/>

							<p class="sr-only" role="status" aria-live="polite">
								{liveSummary()}
							</p>
							<p class="available-listings__updating" aria-hidden="true">
								<Show when={showUpdating()}>Updating…</Show>
							</p>

							<Show
								when={mode() === 'empty'}
								fallback={
									<div class="listings-grid">
										<For each={gridListings()}>
											{(listing) => <ListingCard listing={listing} />}
										</For>
										<ListingGridCta />
									</div>
								}
							>
								<div class="viewport-empty">
									<p class="viewport-empty__lead">No listings in this view yet.</p>
									<button
										type="button"
										class="button button--primary"
										onClick={jumpToNearest}
										disabled={!nearestTarget()}
									>
										{jumpLabel()}
									</button>
									<Link to="/listings/new" class="viewport-empty__grower">
										Have a tree here? Be the first to share →
									</Link>
								</div>

								<Show when={fallbackNearest().length > 0}>
									<hr class="viewport-divider" />
									<h3 class="nearest-heading">Nearest listings</h3>
									<div class="listings-grid">
										<For each={fallbackNearest()}>
											{(listing) => (
												<ListingCard
													listing={listing}
													muted
													badge={`${listing.city} · ${milesTo(listing, fallbackCenter())}`}
												/>
											)}
										</For>
									</div>
								</Show>
							</Show>
						</div>
					</section>
				</main>
			</div>
		</Layout>
	)
}
