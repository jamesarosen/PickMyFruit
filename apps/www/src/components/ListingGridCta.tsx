import { Link } from '@tanstack/solid-router'
import Sprout from 'lucide-solid/icons/sprout'
import '@/components/ListingGridCta.css'

/**
 * A grower call-to-action styled as a trailing card in the listings grid.
 * Deliberately distinct from {@link ListingCard} (dashed, no photo) so it reads
 * as an invitation, not as a real listing.
 */
export default function ListingGridCta() {
	return (
		<Link to="/listings/new" class="listing-grid-cta">
			<span class="listing-grid-cta__icon" aria-hidden="true">
				<Sprout />
			</span>
			<span class="listing-grid-cta__title">Have a tree?</span>
			<span class="listing-grid-cta__body">
				Share your produce with neighbors who will use it.
			</span>
			<span class="listing-grid-cta__action">Add your produce →</span>
		</Link>
	)
}
