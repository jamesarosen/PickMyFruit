import { describe, expect, it } from 'vitest'
import {
	buildCreateSubscriptionData,
	buildLocationConfirmationText,
} from '../src/lib/subscription-draft'

describe('buildCreateSubscriptionData', () => {
	it('uses resolution 7 for ring size 1 and normalizes optional fields', () => {
		const data = buildCreateSubscriptionData({
			label: '  Backyard alerts  ',
			location: {
				lat: 38.2975,
				lng: -122.2869,
				displayName: 'Napa, CA 94558',
			},
			produceTypes: undefined,
			ringSize: 1,
			throttlePeriod: 'immediately',
		})

		expect(data).toMatchObject({
			label: 'Backyard alerts',
			resolution: 7,
			ringSize: 1,
			placeName: 'Napa, CA 94558',
			produceTypes: null,
			throttlePeriod: 'immediately',
		})
		expect(data.centerH3).toMatch(/^[0-9a-f]+$/)
	})
})

describe('buildLocationConfirmationText', () => {
	it('includes ring size label and place name', () => {
		expect(buildLocationConfirmationText('Napa, CA 94558', 1)).toBe(
			'Searching within ~3 miles of Napa, CA 94558'
		)
	})
})
