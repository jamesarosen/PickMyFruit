import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'
import { Show } from 'solid-js'
import { faker } from '@faker-js/faker'
import type { PublicListing } from '../src/data/queries'
import { ListingStatus } from '../src/lib/validation'
import { getStatusClass } from '../src/lib/listing-status'

function makeListing(overrides: Partial<PublicListing> = {}): PublicListing {
	return {
		id: faker.number.int({ min: 1, max: 9999 }),
		name: `${faker.person.firstName()}'s ${faker.helpers.arrayElement(['apple', 'pear', 'fig'])} tree`,
		type: faker.helpers.arrayElement(['apple', 'pear', 'fig']),
		variety: faker.helpers.arrayElement(['Fuji', 'Bartlett', 'Black Mission']),
		status: 'available',
		quantity: faker.helpers.arrayElement(['abundant', 'moderate', 'few']),
		harvestWindow: 'September-October',
		city: 'Napa',
		state: 'CA',
		approximateH3Index: '872830828ffffff',
		userId: faker.string.uuid(),
		notes: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

/** Renders the listing detail UI mirroring the route component. */
function renderDetail(listing: PublicListing | null) {
	return render(() => (
		<Show
			when={listing}
			fallback={
				<main class="listing-page">
					<div class="listing-not-found">
						<h1>Listing Not Found</h1>
						<p>This listing may have been removed or doesn't exist.</p>
					</div>
				</main>
			}
		>
			{(l) => (
				<main class="listing-page">
					<article class="listing-detail">
						<header class="listing-detail-header">
							<h1>{l().type}</h1>
							<span class={`status-badge ${getStatusClass(l().status)}`}>
								{l().status}
							</span>
						</header>
						<div class="listing-info">
							<Show when={l().variety}>
								<div class="info-row">
									<span class="info-label">Variety</span>
									<span class="info-value">{l().variety}</span>
								</div>
							</Show>
							<Show when={l().quantity}>
								<div class="info-row">
									<span class="info-label">Quantity</span>
									<span class="info-value">{l().quantity}</span>
								</div>
							</Show>
							<Show when={l().harvestWindow}>
								<div class="info-row">
									<span class="info-label">Harvest Window</span>
									<span class="info-value">{l().harvestWindow}</span>
								</div>
							</Show>
							<div class="info-row">
								<span class="info-label">Location</span>
								<span class="info-value">
									{l().city}, {l().state}
								</span>
							</div>
							<Show when={l().notes}>
								<div class="info-row info-notes">
									<span class="info-label">Notes</span>
									<span class="info-value">{l().notes}</span>
								</div>
							</Show>
						</div>

						<Show when={l().status === ListingStatus.unavailable}>
							<div class="listing-unavailable">
								<h3>This listing is currently unavailable</h3>
							</div>
						</Show>
					</article>
				</main>
			)}
		</Show>
	))
}

describe('ListingDetail', () => {
	afterEach(cleanup)

	it('displays listing type as heading', () => {
		const listing = makeListing({ type: 'apple' })
		const { getByRole } = renderDetail(listing)

		expect(getByRole('heading', { level: 1 })).toHaveTextContent('apple')
	})

	it('shows variety, quantity, and harvest window', () => {
		const listing = makeListing({
			variety: 'Honeycrisp',
			quantity: 'abundant',
			harvestWindow: 'September-October',
		})
		const { getByText } = renderDetail(listing)

		expect(getByText('Honeycrisp')).toBeInTheDocument()
		expect(getByText('abundant')).toBeInTheDocument()
		expect(getByText('September-October')).toBeInTheDocument()
	})

	it('shows city and state', () => {
		const listing = makeListing({ city: 'Napa', state: 'CA' })
		const { getByText } = renderDetail(listing)

		expect(getByText('Napa, CA')).toBeInTheDocument()
	})

	it('shows notes when present', () => {
		const listing = makeListing({ notes: 'Tree is in the backyard' })
		const { getByText } = renderDetail(listing)

		expect(getByText('Tree is in the backyard')).toBeInTheDocument()
	})

	it('hides notes row when notes is null', () => {
		const listing = makeListing({ notes: null })
		const { queryByText } = renderDetail(listing)

		expect(queryByText('Notes')).not.toBeInTheDocument()
	})

	it('shows not-found message when listing is null', () => {
		const { getByText } = renderDetail(null)

		expect(getByText('Listing Not Found')).toBeInTheDocument()
		expect(
			getByText("This listing may have been removed or doesn't exist.")
		).toBeInTheDocument()
	})

	it('displays status badge with correct class', () => {
		const listing = makeListing({ status: 'available' })
		const { getByText } = renderDetail(listing)

		const badge = getByText('available')
		expect(badge).toHaveClass('status-badge', 'status-available')
	})

	it('shows unavailable notice for unavailable listings', () => {
		const listing = makeListing({ status: 'unavailable' })
		const { getByText } = renderDetail(listing)

		expect(getByText('This listing is currently unavailable')).toBeInTheDocument()
	})

	it('does not show unavailable notice for available listings', () => {
		const listing = makeListing({ status: 'available' })
		const { queryByText } = renderDetail(listing)

		expect(
			queryByText('This listing is currently unavailable')
		).not.toBeInTheDocument()
	})
})

describe('getStatusClass', () => {
	it.each([
		['available', 'status-available'],
		['unavailable', 'status-unavailable'],
		['private', 'status-private'],
	])('returns %s for status "%s"', (status, expected) => {
		expect(getStatusClass(status)).toBe(expected)
	})

	it('returns status-private for unknown status', () => {
		expect(getStatusClass('claimed')).toBe('status-private')
	})
})
