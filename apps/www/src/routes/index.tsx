import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingsMap from '@/components/ListingsMap'
import ListingCard from '@/components/ListingCard'
import Locate from 'lucide-solid/icons/locate'
import { getNearbyListings } from '@/api/listings'
import { normalizeArea, listingMatchesArea } from '@/lib/h3-area'
import {
	NAPA_CITY_HALL,
	requestCurrentLocation,
	type LocationBias,
} from '@/lib/geolocation'
import { trackOnboardingCtaClick } from '@/lib/onboarding-telemetry'
import '@/routes/index.css'

const homeSearchSchema = z.object({
	area: z.string().optional(),
})

export const Route = createFileRoute('/')({
	validateSearch: homeSearchSchema,
	// The loader runs on the server and queries by the launch-city anchor; the
	// map defaults to that framing and recenters only when the user clicks
	// "Center" (below).
	loader: () =>
		getNearbyListings({
			data: { lat: NAPA_CITY_HALL.lat, lng: NAPA_CITY_HALL.lng },
		}),
	component: HomePage,
})

function HomePage() {
	const listings = Route.useLoaderData()
	const navigate = useNavigate()
	const search = Route.useSearch()

	// The map defaults to Napa. Centering on the user is opt-in via the "Center"
	// button, which asks for their position on click; the map then pans there,
	// keeping its zoom. Denial is silent (see requestCurrentLocation).
	const [userLocation, setUserLocation] = createSignal<LocationBias | null>(null)
	const [locating, setLocating] = createSignal(false)

	async function centerOnMyLocation() {
		if (locating()) return
		setLocating(true)
		try {
			const position = await requestCurrentLocation()
			// A fresh object each click re-triggers the map's recenter effect even
			// when the coordinates are unchanged.
			if (position) setUserLocation({ ...position })
		} finally {
			setLocating(false)
		}
	}

	const selectedH3 = () => normalizeArea(search().area ?? null)

	function setSelectedH3(h3: string | null) {
		navigate({
			to: '/',
			search: h3 ? { area: h3 } : {},
			replace: true,
			resetScroll: false,
		})
	}

	const visibleListings = () => {
		const area = selectedH3()
		if (!area) return listings()
		return listings().filter((l) =>
			listingMatchesArea(l.approximateH3Index, area)
		)
	}

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
								<Show when={listings().length > 0}>
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
								</Show>
							</div>
							<Show
								when={listings().length > 0}
								fallback={<p>No listings available right now.</p>}
							>
								<ListingsMap
									listings={listings()}
									center={userLocation()}
									onGroupSelect={setSelectedH3}
									selectedH3={selectedH3()}
								/>
								<Show when={selectedH3()}>
									<button
										type="button"
										class="clear-filter"
										onClick={() => setSelectedH3(null)}
									>
										Show all listings
									</button>
								</Show>
								<Show when={selectedH3() && visibleListings().length === 0}>
									<p class="no-filtered-listings">No listings in this area.</p>
								</Show>
								<div class="listings-grid">
									<For each={visibleListings()}>
										{(listing) => <ListingCard listing={listing} />}
									</For>
								</div>
							</Show>
						</div>
					</section>
				</main>
			</div>
		</Layout>
	)
}
