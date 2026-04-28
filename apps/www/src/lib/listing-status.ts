import { ListingStatus, type ListingStatusValue } from '@/lib/validation'

/** The three visibility states a listing can be in, with user-facing labels. */
export const VISIBILITY_OPTIONS = [
	{
		value: ListingStatus.available,
		label: 'Available',
		description: 'Listed publicly, accepts inquiries',
	},
	{
		value: ListingStatus.unavailable,
		label: 'Unavailable',
		description: 'Listed publicly, but no inquiries, e.g. out of season',
	},
	{
		value: ListingStatus.private,
		label: 'Private',
		description: 'Invisible, but accepts inquiries via direct link',
	},
] as const

/** Maps each listing status to a semantic CSS color variable. */
export const statusSemanticColor: Record<ListingStatusValue, string> = {
	[ListingStatus.available]: 'var(--color-secondary)',
	[ListingStatus.unavailable]: 'var(--color-quiet)',
	[ListingStatus.private]: 'var(--color-accent)',
}

/** The variant suffix shared by `.badge--…` and `.listing-card-status--…`. */
export type StatusVariant = 'available' | 'unavailable' | 'private'

const statusVariantMap: Record<ListingStatusValue, StatusVariant> = {
	[ListingStatus.available]: 'available',
	[ListingStatus.unavailable]: 'unavailable',
	[ListingStatus.private]: 'private',
}

/** Maps a listing status string to its variant suffix. */
export function getStatusVariant(status: string): StatusVariant {
	return statusVariantMap[status as ListingStatusValue] ?? 'private'
}
