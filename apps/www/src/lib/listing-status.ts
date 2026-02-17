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

const statusClassMap: Record<ListingStatusValue, string> = {
	[ListingStatus.available]: 'status-available',
	[ListingStatus.unavailable]: 'status-unavailable',
	[ListingStatus.private]: 'status-private',
}

/** Maps a listing status to its CSS class name. */
export function getStatusClass(status: string): string {
	return statusClassMap[status as ListingStatusValue] ?? 'status-private'
}
