import { Link } from '@tanstack/solid-router'
import { Apple } from 'lucide-solid'
import { Show } from 'solid-js'
import { getStatusClass } from '@/lib/listing-status'
import '@/components/ListingCard.css'

export type ListingCardData = {
	id: number
	name: string
	city: string
	state: string
	photos: { pubUrl: string }[]
	type?: string | null
	variety?: string | null
	quantity?: string | null
	harvestWindow?: string | null
	notes?: string | null
	status?: string | null
}

/** A card linking to a listing detail page, with cover photo or Apple placeholder. */
export default function ListingCard(props: { listing: ListingCardData }) {
	const l = () => props.listing
	return (
		<article class="listing-card surface-subtle">
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
						<span class={`listing-card-status ${getStatusClass(status())}`}>
							{status()}
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
				<p class="listing-card-location">
					{l().city}, {l().state}
				</p>
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
