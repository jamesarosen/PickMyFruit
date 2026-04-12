import { z } from 'zod'
import { produceTypeSlugs } from '@/lib/produce-types'

const optionalZip = z.preprocess(
	(val) => (val === '' || val === null ? undefined : val),
	z
		.string()
		.regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')
		.optional()
)

// Coerce null to empty string for required string fields (triggers min(1) error)
const requiredString = (message: string, max: number = 200) =>
	z.preprocess(
		(val) => (val === null ? '' : val),
		z.string().min(1, message).max(max)
	)

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
	notes: z.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z.string().max(1000).optional()
	),
})

export type ListingFormData = z.infer<typeof listingFormSchema>

// Schema for API input (with geocoded data)
export const createListingSchema = listingFormSchema.extend({
	lat: z.number(),
	lng: z.number(),
	h3Index: z.string(),
})

export type CreateListingData = z.infer<typeof createListingSchema>

// ============================================================================
// Inquiry Schemas
// ============================================================================

export const inquiryFormSchema = z.object({
	listingId: z.number().int().positive('Invalid listing'),
	note: z.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z.string().max(500, 'Note must be 500 characters or less').optional()
	),
})

export type InquiryFormData = z.infer<typeof inquiryFormSchema>

/** Validates the user's display name as set via the profile page or inquiry interstitial. */
export const profileNameSchema = z
	.string()
	.max(100, 'Name must be 100 characters or fewer')

// ============================================================================
// Subscription Schemas
// ============================================================================

export const createSubscriptionSchema = z.object({
	label: z.preprocess(
		(val) => (val === '' || val === null ? undefined : val),
		z.string().max(100).optional()
	),
	centerH3: z.string().min(1),
	resolution: z.number().int().min(6).max(8),
	ringSize: z.number().int().min(0).max(6),
	placeName: z.string().min(1).max(500),
	produceTypes: z.array(z.string()).nullable().optional(),
	throttlePeriod: z.enum(['immediately', 'weekly']),
})

export type CreateSubscriptionData = z.infer<typeof createSubscriptionSchema>

export const updateSubscriptionSchema = z
	.object({
		label: z.preprocess(
			(val) => (val === '' || val === null ? undefined : val),
			z.string().max(100).optional()
		),
		centerH3: z.string().optional(),
		resolution: z.number().int().min(6).max(8).optional(),
		ringSize: z.number().int().min(0).max(6).optional(),
		placeName: z.string().max(500).optional(),
		produceTypes: z.array(z.string()).nullable().optional(),
		throttlePeriod: z.enum(['immediately', 'weekly']).optional(),
		enabled: z.boolean().optional(),
	})
	.refine(
		(data) => {
			const hasCenter = data.centerH3 !== undefined
			const hasResolution = data.resolution !== undefined
			return hasCenter === hasResolution
		},
		{ message: 'centerH3 and resolution must both be provided or both omitted' }
	)

export type UpdateSubscriptionData = z.infer<typeof updateSubscriptionSchema>

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

// Accepts all three statuses; the UI exposes them as a radio group.
export const updateListingStatusSchema = z.object({
	status: z.enum(listingStatusValues, { message: 'Invalid status' }),
})
