import { describe, it, expect } from 'vitest'
import { escapeHtml } from '../src/lib/html-escape.server'

describe('escapeHtml', () => {
	it('escapes HTML special characters', () => {
		expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#039;')
	})

	it('leaves alphanumeric text unchanged', () => {
		expect(escapeHtml('abc123')).toBe('abc123')
	})

	it('escapes ampersands in URLs for safe href interpolation', () => {
		expect(escapeHtml('https://example.com/cb?a=1&b=2')).toBe(
			'https://example.com/cb?a=1&amp;b=2'
		)
	})
})
