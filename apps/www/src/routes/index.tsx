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
import { trackOnboardingCtaClick } from '@/lib/onboarding-telemetry'
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

	// The picker CTAs glide to the listings instead of the anchor's instant
	// jump. The href stays as a real fragment so the link still works without
	// JS (e.g. opened in a new tab).
	function scrollToListings(event: MouseEvent) {
		event.preventDefault()
		event.stopPropagation()
		const section = document.getElementById('available-listings')
		if (!section) return
		section.scrollIntoView({ behavior: 'smooth' })
		// preventDefault suppresses the browser's native focus move to the
		// anchor target; restore it for keyboard and screen-reader users.
		section.focus({ preventScroll: true })
	}

	return (
		<Layout title="Pick My Fruit - Turn your backyard abundance into community food">
			<div class="home-page">
				<PageHeader />

				<main id="main-content">
					<section class="hero surface-subtle">
						<div class="container">
							<h1>Share the Harvest, Neighbor to Neighbor</h1>
							<p class="hero-subtitle">
								Backyard growers share their surplus. Neighbors pick it fresh.
								<br />
								Come with a harvest, an appetite, or both.
								<br />
								Rooted in Napa. Growing everywhere.
							</p>
							<div class="hero-actions">
								<Link
									to="/listings/new"
									class="button button--primary button--lg"
									onClick={() => trackOnboardingCtaClick('grower', 'hero')}
								>
									Share What I'm Growing
								</Link>
								<a
									href="#available-listings"
									class="button button--ghost button--lg"
									onClick={(event) => {
										trackOnboardingCtaClick('picker', 'hero')
										scrollToListings(event)
									}}
								>
									Find Fruit to Pick
								</a>
							</div>
						</div>
					</section>

					<section class="how-it-works">
						<div class="container">
							<h2>How It Works</h2>
							<div class="paths">
								<article class="path" aria-labelledby="path-grower">
									<h3 id="path-grower">Got more fruit than you can use?</h3>
									<ol class="steps">
										<li class="step">
											<h4>Tell us about your produce</h4>
											<p>Takes 30 seconds</p>
										</li>
										<li class="step">
											<h4>Neighbors find your listing</h4>
											<p>You get an email when someone wants to pick</p>
										</li>
										<li class="step">
											<h4>They pick (or pick up), you relax</h4>
											<p>Surplus feeds families</p>
										</li>
									</ol>
									<Link
										to="/listings/new"
										class="button button--primary"
										onClick={() => trackOnboardingCtaClick('grower', 'how-it-works')}
									>
										Add a Listing
									</Link>
								</article>
								<article class="path" aria-labelledby="path-picker">
									<h3 id="path-picker">No garden? No problem.</h3>
									<ol class="steps">
										<li class="step">
											<h4>Browse what's growing nearby</h4>
											<p>The map below shows what neighbors are sharing</p>
										</li>
										<li class="step">
											<h4>Ask to pick</h4>
											<p>All you need is an email address</p>
										</li>
										<li class="step">
											<h4>Meet your neighbor, fill your basket</h4>
											<p>Good fruit, good company</p>
										</li>
									</ol>
									<a
										href="#available-listings"
										class="button button--primary"
										onClick={(event) => {
											trackOnboardingCtaClick('picker', 'how-it-works')
											scrollToListings(event)
										}}
									>
										Browse What's Ripe
									</a>
								</article>
							</div>
							<p class="paths-both-note">
								Plenty of neighbors do both — share the plums in July, pick the apples
								in October.
							</p>
						</div>
					</section>

					<section class="available-listings" id="available-listings" tabindex="-1">
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
