import { Link } from '@tanstack/solid-router'
import { Apple } from 'lucide-solid'
import { Show } from 'solid-js'
import { getStatusLabel, getStatusVariant } from '@/lib/listing-status'
import { formatListingLocation } from '@/lib/format-location'
import { PRODUCE_STAND_SLUG } from '@/lib/produce-types'
import DropOffIndicator from '@/components/DropOffIndicator'
import '@/components/ListingCard.css'

export type ListingCardData = {
	id: number
	name: string
	city: string
	state: string | null
	country: string
	photos: { pubUrl: string }[]
	type?: string | null
	variety?: string | null
	quantity?: string | null
	harvestWindow?: string | null
	notes?: string | null
	status?: string | null
	acceptsDropOffs?: boolean
}

/** A card linking to a listing detail page, with cover photo or Apple placeholder. */
export default function ListingCard(props: { listing: ListingCardData }) {
	const l = () => props.listing
	return (
		<article class="listing-card surface-subtle">
			<Show when={l().type === PRODUCE_STAND_SLUG}>
				<DropOffIndicator
					class="listing-card-dropoff"
					acceptsDropOffs={l().acceptsDropOffs ?? false}
				/>
			</Show>
			<Link
				to="/listings/$id"
				params={{ id: String(l().id) }}
				class="listing-card-link"
			>
				<h3>{l().name}</h3>

				<Show
					when={l().photos[0]?.pubUrl}
					fallback={
						<span
							class="listing-card-thumb listing-card-thumb--placeholder"
							aria-hidden="true"
						>
							<Apple />
						</span>
					}
				>
					{(coverUrl) => (
						<img
							alt=""
							class="listing-card-thumb"
							decoding="async"
							loading="lazy"
							src={coverUrl()}
						/>
					)}
				</Show>

				<Show when={l().status}>
					{(status) => (
						<span
							class={`listing-card-status listing-card-status--${getStatusVariant(status())}`}
						>
							{getStatusLabel(status())}
						</span>
					)}
				</Show>
				<Show when={l().type && l().variety}>
					<p class="listing-card-variety">
						{l().type} – {l().variety}
					</p>
				</Show>
				<Show when={l().quantity}>
					<p class="listing-card-quantity">Quantity: {l().quantity}</p>
				</Show>
				<p class="listing-card-location">{formatListingLocation(l())}</p>
				<Show when={l().harvestWindow}>
					<p class="listing-card-harvest">Harvest: {l().harvestWindow}</p>
				</Show>
				<Show when={l().notes}>
					<p class="listing-card-notes">{l().notes}</p>
				</Show>
			</Link>
		</article>
	)
}
