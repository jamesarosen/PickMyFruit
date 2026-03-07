import { describe, it, expect } from 'vitest'
import { capitalize } from '../src/lib/capitalize'

describe('capitalize', () => {
	it.each([
		['hello', 'Hello'],
		['world', 'World'],
		['apple butter', 'Apple butter'],
		['already Capitalized', 'Already Capitalized'],
		['a', 'A'],
	])('capitalizes the first character of "%s"', (input, expected) => {
		expect(capitalize(input)).toBe(expected)
	})

	it('returns empty string unchanged', () => {
		expect(capitalize('')).toBe('')
	})
})
