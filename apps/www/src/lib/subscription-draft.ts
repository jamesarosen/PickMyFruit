import { latLngToCell } from 'h3-js'
import {
	RING_SIZE_LABELS,
	resolutionForRingSize,
} from '@/lib/subscription-labels'
import type { CreateSubscriptionData } from '@/lib/validation'

/** Geocoded place details used to build a subscription draft. */
export interface GeocodedSubscriptionLocation {
	lat: number
	lng: number
	displayName: string
}

interface BuildCreateSubscriptionDataInput {
	label?: string
	location: GeocodedSubscriptionLocation
	produceTypes?: string[] | null
	ringSize: number
	throttlePeriod: 'immediately' | 'weekly'
}

/** Builds a validated create-subscription payload from a geocoded search result. */
export function buildCreateSubscriptionData(
	input: BuildCreateSubscriptionDataInput
): CreateSubscriptionData {
	const resolution = resolutionForRingSize(input.ringSize)
	return {
		label: input.label?.trim() || undefined,
		centerH3: latLngToCell(input.location.lat, input.location.lng, resolution),
		resolution,
		ringSize: input.ringSize,
		placeName: input.location.displayName,
		produceTypes: input.produceTypes ?? null,
		throttlePeriod: input.throttlePeriod,
	}
}

/** Builds the post-search confirmation sentence shown below the address field. */
export function buildLocationConfirmationText(
	placeName: string,
	ringSize: number
): string {
	return `Searching within ${RING_SIZE_LABELS[ringSize]} of ${placeName}`
}
