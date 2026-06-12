import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingsMap from '@/components/ListingsMap'
import ListingCard from '@/components/ListingCard'
import { getNearbyListings } from '@/api/listings'
import { normalizeArea } from '@/lib/h3-area'
import {
	filterListings,
	normalizeTypeFilter,
	presentTypes,
} from '@/lib/listing-filters'
import '@/routes/index.css'

// Napa City Hall — will be replaced with geolocation later
const DEFAULT_CENTER = { lat: 38.2966234, lng: -122.2893688 }

const homeSearchSchema = z.object({
	area: z.string().optional(),
	type: z.string().optional(),
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
	const selectedType = () => normalizeTypeFilter(search().type)

	function setSelectedH3(h3: string | null) {
		navigate({
			to: '/',
			search: (prev) => ({ ...prev, area: h3 ?? undefined }),
			replace: true,
			resetScroll: false,
		})
	}

	const typeChips = () => presentTypes(listings())
	const visibleListings = () =>
		filterListings(listings(), selectedH3(), selectedType())

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
									onGroupSelect={setSelectedH3}
									selectedH3={selectedH3()}
								/>
								<Show when={typeChips().length > 1}>
									<div
										class="type-filter"
										role="group"
										aria-label="Filter by produce type"
									>
										{/* Links (not buttons) so the filter works before hydration. */}
										<Link
											to="/"
											search={(prev) => ({ ...prev, type: undefined })}
											replace
											resetScroll={false}
											class={`chip${!selectedType() ? ' chip--active' : ''}`}
											aria-current={!selectedType() ? 'true' : undefined}
										>
											All
										</Link>
										<For each={typeChips()}>
											{(chip) => (
												<Link
													to="/"
													search={(prev) => ({ ...prev, type: chip.slug })}
													replace
													resetScroll={false}
													class={`chip${selectedType() === chip.slug ? ' chip--active' : ''}`}
													aria-current={selectedType() === chip.slug ? 'true' : undefined}
												>
													{chip.label}
												</Link>
											)}
										</For>
									</div>
								</Show>
								<Show when={selectedH3()}>
									<button
										type="button"
										class="clear-filter"
										onClick={() => {
											setSelectedH3(null)
										}}
									>
										Show all listings
									</button>
								</Show>
								<Show
									when={
										(selectedH3() || selectedType()) && visibleListings().length === 0
									}
								>
									<p class="no-filtered-listings">
										{selectedType()
											? 'No listings match your filters.'
											: 'No listings in this area.'}
									</p>
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
