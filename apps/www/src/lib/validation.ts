import { z } from 'zod'
import { isValidCell, getResolution } from 'h3-js'
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

// ============================================================================
// Notification Subscription Schemas
// ============================================================================

/** Maximum number of notification subscriptions a single user may create. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10

const throttlePeriodValues = ['hourly', 'daily', 'weekly'] as const

/** Validates that both centerH3 and resolution are present and consistent. */
const h3ResolutionConsistent = (d: {
	centerH3?: string
	resolution?: number
}) =>
	d.centerH3 === undefined ||
	d.resolution === undefined ||
	getResolution(d.centerH3) === d.resolution

const subscriptionBaseSchema = z.object({
	locationName: z.string().max(200).default(''),
	throttlePeriod: z.enum(throttlePeriodValues, {
		message: 'Please select a notification frequency',
	}),
	produceTypes: z
		.array(
			z
				.string()
				.refine((v) => produceTypeSlugs.has(v), { message: 'Invalid produce type' })
		)
		.optional(), // undefined = all types
	centerH3: z
		.string()
		.min(1, 'Location is required')
		.refine((v) => isValidCell(v), { message: 'Invalid H3 cell' }),
	resolution: z.number().int().min(5).max(8),
	ringSize: z.number().int().min(0).max(6).default(0),
})

export const createSubscriptionSchema = subscriptionBaseSchema.refine(
	h3ResolutionConsistent,
	{
		message: 'centerH3 resolution does not match resolution field',
		path: ['centerH3'],
	}
)

export type CreateSubscriptionData = z.infer<typeof createSubscriptionSchema>

export const updateSubscriptionSchema = subscriptionBaseSchema
	.partial()
	.extend({
		id: z.number().int().positive(),
	})
	.refine(h3ResolutionConsistent, {
		message: 'centerH3 resolution does not match resolution field',
		path: ['centerH3'],
	})

export type UpdateSubscriptionData = z.infer<typeof updateSubscriptionSchema>
