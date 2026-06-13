import {
	AddressReleasePolicy,
	ListingStatus,
	type AddressReleasePolicyValue,
	type ListingStatusValue,
} from '@/lib/validation'

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

/** Maps a listing status string to its user-facing label. */
export function getStatusLabel(status: string): string {
	return (
		VISIBILITY_OPTIONS.find((option) => option.value === status)?.label ?? status
	)
}

/** The two address-release policies, with the same shape as VISIBILITY_OPTIONS. */
export const ADDRESS_RELEASE_OPTIONS = [
	{
		value: AddressReleasePolicy.onOwnerApproval,
		label: 'Approve each request',
		description: 'You approve every request before your address is shared.',
	},
	{
		value: AddressReleasePolicy.onVerifiedRequest,
		label: 'Share with verified members',
		description:
			'Anyone signed in with a verified email sees the address — treat it as effectively public.',
	},
] as const

/** Semantic color per address-release policy, used to tint the radio label. */
export const addressReleaseSemanticColor: Record<
	AddressReleasePolicyValue,
	string
> = {
	[AddressReleasePolicy.onOwnerApproval]: 'var(--color-secondary)',
	[AddressReleasePolicy.onVerifiedRequest]: 'var(--color-accent)',
}
