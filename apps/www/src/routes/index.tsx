import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router'
import { createSignal, For, onMount, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingsMap from '@/components/ListingsMap'
import ListingCard from '@/components/ListingCard'
import { getNearbyListings } from '@/api/listings'
import { normalizeArea, listingMatchesArea } from '@/lib/h3-area'
import {
	NAPA_CITY_HALL,
	requestCurrentLocation,
	type LocationBias,
} from '@/lib/geolocation'
import '@/routes/index.css'

const homeSearchSchema = z.object({
	area: z.string().optional(),
})

export const Route = createFileRoute('/')({
	validateSearch: homeSearchSchema,
	// The loader runs on the server and cannot know the client's position, so it
	// queries by the launch-city anchor; the client recenters the map (below).
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

	// Ask for the user's position on mount; when granted, the map centers there
	// instead of framing Napa. Denial is silent (see requestCurrentLocation).
	const [userLocation, setUserLocation] = createSignal<LocationBias | null>(null)
	onMount(() => {
		void requestCurrentLocation().then((position) => {
			if (position) setUserLocation(position)
		})
	})

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
							<h2>Available Now</h2>
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
