import { z } from 'zod'
import { produceTypeSlugs } from '@/lib/produce-types'

const optionalZip = z
	.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z
			.string()
			.regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')
			.optional()
	)
	.optional()

// Coerce null to empty string for required string fields (triggers min(1) error)
const requiredString = (message: string, max: number = 200) =>
	z.preprocess(
		(val) => (val === null ? '' : val),
		z.string().min(1, message).max(max)
	)

/** Allowed values for a listing's address-release policy. */
export const AddressReleasePolicy = {
	onOwnerApproval: 'on_owner_approval',
	onVerifiedRequest: 'on_verified_request',
} as const

export type AddressReleasePolicyValue =
	(typeof AddressReleasePolicy)[keyof typeof AddressReleasePolicy]

const addressReleasePolicyValues = Object.values(AddressReleasePolicy) as [
	AddressReleasePolicyValue,
	...AddressReleasePolicyValue[],
]

// Schema for form input (before geocoding)
export const listingFormSchema = z.object({
	type: z.preprocess(
		(val) => (val === null ? '' : val),
		z
			.string({ message: 'Please select a produce type' })
			.refine((v) => produceTypeSlugs.has(v), {
				message: 'Please select a produce type',
			})
	),
	harvestWindow: requiredString('Harvest window is required', 50),
	address: requiredString('Address is required', 200),
	city: requiredString('City is required', 100),
	state: z.preprocess(
		(val) => (val === null ? '' : val),
		z.string().length(2, 'State must be 2 characters')
	),
	zip: optionalZip,
	notes: z
		.preprocess(
			(val) => (val === '' || val === null ? undefined : val),
			z.string().max(1000).optional()
		)
		.optional(),
	addressReleasePolicy: z
		.enum(addressReleasePolicyValues)
		.default(AddressReleasePolicy.onOwnerApproval),
})

export type ListingFormData = z.infer<typeof listingFormSchema>

// Schema for API input (with geocoded data)
export const createListingSchema = listingFormSchema.extend({
	lat: z.number().gte(-90).lte(90),
	lng: z.number().gte(-180).lte(180),
})

export type CreateListingData = z.infer<typeof createListingSchema>

// ============================================================================
// Inquiry Schemas
// ============================================================================

export const inquiryFormSchema = z.object({
	listingId: z.number().int().positive('Invalid listing'),
	note: z
		.preprocess(
			(val) => (val === '' || val === null ? undefined : val),
			z.string().max(500, 'Note must be 500 characters or less').optional()
		)
		.optional(),
})

export type InquiryFormData = z.infer<typeof inquiryFormSchema>

/** Validates the user's display name as set via the profile page or inquiry interstitial. */
export const profileNameSchema = z
	.string()
	.max(100, 'Name must be 100 characters or fewer')

export const ListingStatus = {
	available: 'available',
	unavailable: 'unavailable',
	private: 'private',
} as const

export type ListingStatusValue =
	(typeof ListingStatus)[keyof typeof ListingStatus]

const listingStatusValues = Object.values(ListingStatus) as [
	ListingStatusValue,
	...ListingStatusValue[],
]

/**
 * Flat update schema — any combination of data fields may be present, but at
 * least one data field (anything other than `id` / `clientUpdatedAt`) is
 * required. `clientUpdatedAt` carries the epoch-seconds timestamp of the last
 * known `updatedAt` and is used for optimistic concurrency.
 */
export const updateListingSchema = z
	.object({
		id: z.number().int().positive(),
		clientUpdatedAt: z.number().int(),
		status: z.enum(listingStatusValues).optional(),
		name: z.string().min(1).max(200).optional(),
		harvestWindow: z.string().min(1).max(50).optional(),
		variety: z.string().max(200).nullable().optional(),
		quantity: z.string().max(100).nullable().optional(),
		notes: z.string().max(1000).nullable().optional(),
		addressReleasePolicy: z.enum(addressReleasePolicyValues).optional(),
	})
	.refine(
		(d) =>
			[
				d.status,
				d.name,
				d.harvestWindow,
				d.variety,
				d.quantity,
				d.notes,
				d.addressReleasePolicy,
			].some((v) => v !== undefined),
		{ message: 'At least one field must be updated' }
	)
