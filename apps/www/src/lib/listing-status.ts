import { ListingStatus, type ListingStatusValue } from '@/lib/validation'

const statusClassMap: Record<ListingStatusValue, string> = {
	[ListingStatus.available]: 'status-available',
	[ListingStatus.unavailable]: 'status-unavailable',
	[ListingStatus.private]: 'status-private',
}

/** Maps a listing status to its CSS class name. */
export function getStatusClass(status: string): string {
	return statusClassMap[status as ListingStatusValue] ?? 'status-private'
}
