import { describe, it, expect, vi } from 'vitest'

describe('produceTypes legacy browser compatibility', () => {
	it('loads and sorts alphabetically when Array.prototype.toSorted is unavailable', async () => {
		expect.hasAssertions()

		// @ts-expect-error simulate runtimes without ES2023 Array.prototype.toSorted
		delete Array.prototype.toSorted
		vi.resetModules()

		const { produceTypes } = await import('../src/lib/produce-types')

		expect(produceTypes.length).toBeGreaterThan(0)

		const names = produceTypes.map((t) => t.nameSingularTitleCase)
		const sorted = [...names].sort((a, b) => a.localeCompare(b))
		expect(names).toStrictEqual(sorted)
	})
})
