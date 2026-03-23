import { describe, it, expect } from 'vitest'
import { produceTypes, produceTypeSlugs } from '../src/lib/produce-types'

const LEGACY_SLUGS = [
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

describe('produceTypes', () => {
	it('parses to a non-empty array with the expected shape', () => {
		expect(produceTypes.length).toBeGreaterThan(0)
		for (const t of produceTypes) {
			expect(typeof t.slug).toBe('string')
			expect(typeof t.category).toBe('string')
			expect(typeof t.nameSingularTitleCase).toBe('string')
			expect(typeof t.namePluralTitleCase).toBe('string')
			expect(typeof t.nameSingularSentenceCase).toBe('string')
			expect(typeof t.namePluralSentenceCase).toBe('string')
		}
	})

	it.each(LEGACY_SLUGS)('contains legacy slug "%s"', (slug) => {
		expect(produceTypeSlugs.has(slug)).toBe(true)
	})

	it('has no duplicate slugs', () => {
		const slugs = produceTypes.map((t) => t.slug)
		const unique = new Set(slugs)
		expect(unique.size).toBe(slugs.length)
	})

	it('all slugs match the slug format /^[a-z][a-z0-9-]*$/', () => {
		const slugPattern = /^[a-z][a-z0-9-]*$/
		for (const t of produceTypes) {
			expect(t.slug).toMatch(slugPattern)
		}
	})

	it('all categories are from the allowed set', () => {
		const allowed = new Set([
			'fruit',
			'vegetable',
			'herb',
			'egg',
			'honey',
			'seedling',
			'preserved',
			'other',
		])
		for (const t of produceTypes) {
			expect(allowed.has(t.category)).toBe(true)
		}
	})
})

describe('name variants', () => {
	it.each([
		// slug                nSTC                  nPTC                  nSSC                  nPSC
		['apple', 'Apple', 'Apples', 'apple', 'apples'],
		['orange', 'Orange', 'Oranges', 'orange', 'oranges'],
		['cherry', 'Cherry', 'Cherries', 'cherry', 'cherries'],
		['raspberry', 'Raspberry', 'Raspberries', 'raspberry', 'raspberries'],
		['thyme', 'Thyme', 'Thyme', 'thyme', 'thyme'],
		['garlic', 'Garlic', 'Garlic', 'garlic', 'garlic'],
		['chives', 'Chives', 'Chives', 'chives', 'chives'],
		['mushrooms', 'Mushrooms', 'Mushrooms', 'mushrooms', 'mushrooms'],
		['asparagus', 'Asparagus', 'Asparagus', 'asparagus', 'asparagus'],
		[
			'brussels-sprouts',
			'Brussels Sprouts',
			'Brussels Sprouts',
			'brussels sprouts',
			'brussels sprouts',
		],
	] as const)(
		'%s: nSTC=%s nPTC=%s nSSC=%s nPSC=%s',
		(slug, nSTC, nPTC, nSSC, nPSC) => {
			const type = produceTypes.find((t) => t.slug === slug)
			expect(type?.nameSingularTitleCase).toBe(nSTC)
			expect(type?.namePluralTitleCase).toBe(nPTC)
			expect(type?.nameSingularSentenceCase).toBe(nSSC)
			expect(type?.namePluralSentenceCase).toBe(nPSC)
		}
	)
})

describe('produceTypeSlugs', () => {
	it('returns true for a valid slug', () => {
		expect(produceTypeSlugs.has('apple')).toBe(true)
	})

	it('returns false for an invalid slug', () => {
		expect(produceTypeSlugs.has('unicorn-fruit')).toBe(false)
	})

	it('returns false for an empty string', () => {
		expect(produceTypeSlugs.has('')).toBe(false)
	})
})
