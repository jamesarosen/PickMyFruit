import { z } from 'zod'

export const fruitTypes = [
	'apple',
	'apricot',
	'avocado',
	'cherry',
	'fig',
	'grape',
	'grapefruit',
	'lemon',
	'lime',
	'nectarine',
	'olive',
	'orange',
	'peach',
	'pear',
	'persimmon',
	'plum',
	'pomegranate',
	'quince',
	'walnut',
	'other',
] as const
export type FruitType = (typeof fruitTypes)[number]

// Normalize empty strings and null to undefined for optional fields
const optionalEmail = z.preprocess(
	(val) => (val === '' || val === null ? undefined : val),
	z.string().email('Invalid email address').optional()
)

const optionalPhone = z.preprocess(
	(val) => (val === '' || val === null ? undefined : val),
	z
		.string()
		.regex(/^[\d\s\-().+]+$/, 'Invalid phone number')
		.optional()
)

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
export const listingFormSchema = z
	.object({
		type: z.enum(fruitTypes, { message: 'Please select a fruit type' }),
		harvestWindow: requiredString('Harvest window is required', 50),
		address: requiredString('Address is required', 200),
		city: requiredString('City is required', 100),
		state: z.preprocess(
			(val) => (val === null ? '' : val),
			z.string().length(2, 'State must be 2 characters')
		),
		zip: optionalZip,
		ownerName: requiredString('Your name is required', 100),
		ownerEmail: optionalEmail,
		ownerPhone: optionalPhone,
		notes: z.preprocess(
			(val) => (val === '' || val === null ? undefined : val),
			z.string().max(1000).optional()
		),
	})
	.refine((data) => data.ownerEmail || data.ownerPhone, {
		message: 'Please provide either an email or phone number',
		path: ['ownerEmail'],
	})

export type ListingFormData = z.infer<typeof listingFormSchema>

// Schema for API input (with geocoded data)
export const createListingSchema = listingFormSchema.extend({
	lat: z.number(),
	lng: z.number(),
	h3Index: z.string(),
})

export type CreateListingData = z.infer<typeof createListingSchema>
