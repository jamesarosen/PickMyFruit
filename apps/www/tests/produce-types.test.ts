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
			expect(t).toHaveProperty('slug')
			expect(t).toHaveProperty('commonName')
			expect(t).toHaveProperty('category')
			expect(typeof t.slug).toBe('string')
			expect(typeof t.commonName).toBe('string')
			expect(typeof t.category).toBe('string')
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
