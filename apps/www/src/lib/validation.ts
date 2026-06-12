import { z } from 'zod'
import { produceTypeSlugs, PRODUCE_STAND_SLUG } from '@/lib/produce-types'

// Postal code formats vary by country — only bound the length.
const optionalPostalCode = z
	.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z.string().max(20, 'Invalid postal code').optional()
	)
	.optional()

// Region/state/province line — many jurisdictions have none.
const optionalRegion = z
	.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z.string().max(100).optional()
	)
	.optional()

// ISO 3166-1 alpha-2 country code, case-insensitive on input.
const countryCode = z.preprocess(
	(val) => (val === '' || val == null ? undefined : String(val).toUpperCase()),
	z
		.string()
		.regex(/^[A-Z]{2}$/, 'Invalid country')
		.default('US')
)

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

// Coerce checkbox/string/number inputs into a boolean.
const coercedBoolean = z.preprocess((val) => {
	if (typeof val === 'boolean') return val
	if (val === 'true' || val === 'on' || val === 1 || val === '1') return true
	if (
		val === 'false' ||
		val === 'off' ||
		val === 0 ||
		val === '0' ||
		val == null
	)
		return false
	return val
}, z.boolean())

/**
 * Cross-field rule for the produce-stand type: because anyone can drop produce
 * at a stand, the steward must acknowledge the raw-whole-produce restriction.
 * Keyed on the `produce-stand` produce type — the address-release policy is
 * orthogonal and not involved.
 *
 * Shared by the form and the API schemas so both boundaries enforce the same
 * invariant.
 */
function refineStandPreset(
	data: { type: string; acceptsDropOffs: boolean; tosAcknowledged: boolean },
	ctx: z.RefinementCtx
) {
	if (data.type !== PRODUCE_STAND_SLUG) return
	if (data.acceptsDropOffs && !data.tosAcknowledged) {
		ctx.addIssue({
			code: 'custom',
			path: ['tosAcknowledged'],
			message: 'Please acknowledge the produce-stand restrictions to continue.',
		})
	}
}

// Schema for form input (before geocoding)
const listingFormBase = z.object({
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
	state: optionalRegion,
	zip: optionalPostalCode,
	country: countryCode,
	notes: z
		.preprocess(
			(val) => (val === '' || val === null ? undefined : val),
			z.string().max(1000).optional()
		)
		.optional(),
	addressReleasePolicy: z
		.enum(addressReleasePolicyValues)
		.default(AddressReleasePolicy.onOwnerApproval),
	acceptsDropOffs: coercedBoolean.default(false),
	tosAcknowledged: coercedBoolean.default(false),
})

export const listingFormSchema = listingFormBase.superRefine(refineStandPreset)

export type ListingFormData = z.infer<typeof listingFormSchema>

// Schema for API input (with geocoded data)
export const createListingSchema = listingFormBase
	.extend({
		lat: z.number().gte(-90).lte(90),
		lng: z.number().gte(-180).lte(180),
	})
	.superRefine(refineStandPreset)

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
		acceptsDropOffs: coercedBoolean.optional(),
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
				d.acceptsDropOffs,
			].some((v) => v !== undefined),
		{ message: 'At least one field must be updated' }
	)
