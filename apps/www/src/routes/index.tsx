import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingsMap from '@/components/ListingsMap'
import { getNearbyListings } from '@/api/listings'
import { normalizeArea, listingMatchesArea } from '@/lib/h3-area'
import '@/routes/index.css'

// Napa City Hall — will be replaced with geolocation later
const DEFAULT_CENTER = { lat: 38.2966234, lng: -122.2893688 }

const homeSearchSchema = z.object({
	area: z.string().optional(),
})

export const Route = createFileRoute('/')({
	validateSearch: homeSearchSchema,
	loader: () =>
		getNearbyListings({
			data: { lat: DEFAULT_CENTER.lat, lng: DEFAULT_CENTER.lng },
		}),
	component: HomePage,
})

function HomePage() {
	const listings = Route.useLoaderData()
	const navigate = useNavigate()
	const search = Route.useSearch()

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
								Starting in Napa and available everywhere.
							</p>
							<Link to="/listings/new" class="cta-button">
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
									<h3>We match you with neighbors</h3>
									<p>You get notified</p>
								</div>
								<div class="step">
									<div class="step-number">3</div>
									<h3>They pick (or pick up), you relax</h3>
									<p>Surplus feeds families</p>
								</div>
							</div>
							<Link to="/listings/new" class="cta-button">
								Add a Listing
							</Link>
						</div>
					</section>

					<section class="available-listings">
						<div class="container">
							<h2>Available Now in Napa</h2>
							<Show
								when={listings().length > 0}
								fallback={<p>No listings available right now.</p>}
							>
								<ListingsMap
									listings={listings()}
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
										{(listing) => (
											<Link
												to="/listings/$id"
												params={{ id: String(listing.id) }}
												class="listing-card surface-subtle"
											>
												<h3>{listing.name}</h3>
												<p class="listing-variety">
													{listing.type} - {listing.variety}
												</p>
												<p class="listing-quantity">Quantity: {listing.quantity}</p>
												<p class="listing-harvest">Harvest: {listing.harvestWindow}</p>
												<p class="listing-location">
													{listing.city}, {listing.state}
												</p>
												{listing.notes && <p class="listing-notes">{listing.notes}</p>}
											</Link>
										)}
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
