import { describe, it, expect } from 'vitest'
import { buildListingMeta } from '../src/lib/listing-meta'
import { produceTypes } from '../src/lib/produce-types'

// Twitter/X official hard limits (see https://developer.x.com/en/docs/twitter-for-websites/cards/overview/markup).
// We aim well under the display cutoffs of ~55 chars for title and ~160 chars
// for description so nothing gets clipped mid-sentence in previews.
const TITLE_MAX = 70
const DESCRIPTION_MAX = 200

describe('buildListingMeta', () => {
	it('returns undefined for missing listing', () => {
		expect(buildListingMeta(undefined)).toBeUndefined()
		expect(buildListingMeta(null)).toBeUndefined()
	})

	it('returns undefined for an unknown produce slug', () => {
		expect(
			buildListingMeta({ type: 'unicorn-fruit', city: 'Napa', state: 'CA' })
		).toBeUndefined()
	})

	it('titlecases the plural form in the title', () => {
		const meta = buildListingMeta({ type: 'apple', city: 'Napa', state: 'CA' })
		expect(meta?.title).toBe('Pick My Apples')
	})

	it('uses sentence-case plural in the description', () => {
		const meta = buildListingMeta({
			type: 'raspberry',
			city: 'Napa',
			state: 'CA',
		})
		expect(meta?.description).toContain('raspberries')
		expect(meta?.description).toContain('Napa, CA')
	})

	it('handles produce whose plural equals singular (mass nouns)', () => {
		const meta = buildListingMeta({ type: 'garlic', city: 'Napa', state: 'CA' })
		expect(meta?.title).toBe('Pick My Garlic')
		expect(meta?.description).toMatch(/^Fresh garlic ready to share/)
	})

	it('includes variety when provided', () => {
		const meta = buildListingMeta({
			type: 'apple',
			variety: 'Honeycrisp',
			city: 'Napa',
			state: 'CA',
		})
		expect(meta?.description).toContain('Honeycrisp apples')
	})

	it('omits variety phrase when null or empty', () => {
		const meta = buildListingMeta({
			type: 'apple',
			variety: null,
			city: 'Napa',
			state: 'CA',
		})
		expect(meta?.description).not.toMatch(/null|undefined/)
		expect(meta?.description).toMatch(/^Fresh apples/)
	})

	it.each(produceTypes.map((t) => [t.slug] as const))(
		'produces title and description within Twitter limits for %s',
		(slug) => {
			const meta = buildListingMeta({
				type: slug,
				city: 'Napa',
				state: 'CA',
			})
			expect(meta).toBeDefined()
			expect(meta!.title.length).toBeLessThanOrEqual(TITLE_MAX)
			expect(meta!.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
		}
	)
})
