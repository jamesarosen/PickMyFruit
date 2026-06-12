import { describe, expect, it } from 'vitest'
import { formatListingLocation } from '../src/lib/format-location'

describe('formatListingLocation', () => {
	it.each([
		{
			label: 'US listing with abbreviated state (legacy rows)',
			fields: { city: 'Napa', state: 'CA', country: 'US' },
			expected: 'Napa, CA',
		},
		{
			label: 'US listing with full region name (suggestion rows)',
			fields: { city: 'St. Helena', state: 'California', country: 'US' },
			expected: 'St. Helena, California',
		},
		{
			label: 'non-US listing without a region line',
			fields: { city: 'Paris', state: null, country: 'FR' },
			expected: 'Paris, France',
		},
		{
			label: 'non-US listing with a region line',
			fields: { city: 'Victoria', state: 'British Columbia', country: 'CA' },
			expected: 'Victoria, British Columbia, Canada',
		},
		{
			label: 'city-state with an empty region line',
			fields: { city: 'Singapore', state: '', country: 'SG' },
			expected: 'Singapore',
		},
		{
			label: 'US listing with an empty region line',
			fields: { city: 'Somewhere', state: '', country: 'US' },
			expected: 'Somewhere',
		},
	])('formats $label', ({ fields, expected }) => {
		expect(formatListingLocation(fields)).toBe(expected)
	})

	it('falls back to the raw code when the country is not displayable', () => {
		expect(
			formatListingLocation({ city: 'Atlantis', state: null, country: '12' })
		).toBe('Atlantis, 12')
	})

	it('deduplicates repeated parts (e.g. city-states)', () => {
		expect(
			formatListingLocation({
				city: 'Singapore',
				state: 'Singapore',
				country: 'SG',
			})
		).toBe('Singapore')
	})
})
