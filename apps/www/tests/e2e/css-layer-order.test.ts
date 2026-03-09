import { test, expect } from './helpers/fixtures'

/**
 * Guards the invariant that the @layer ordering declaration always appears
 * before any <link rel="stylesheet"> tags in the SSR-rendered HTML.
 *
 * The inline <style> in RootShell's <head> must win the race so that cascade
 * priority (base < components < page < utilities) is established before any
 * route CSS is injected — on both initial load and SPA navigation.
 */
test('CSS @layer ordering declaration precedes stylesheets in the HTML head', async ({
	page,
}) => {
	await page.goto('/')

	const layerDeclarationIndex = await page.evaluate(() => {
		const headChildren = Array.from(document.head.children)
		return headChildren.findIndex(
			(el) =>
				el.tagName === 'STYLE' &&
				el.textContent?.includes('@layer base, components, page, utilities')
		)
	})

	const firstStylesheetIndex = await page.evaluate(() => {
		const headChildren = Array.from(document.head.children)
		return headChildren.findIndex(
			(el) => el.tagName === 'LINK' && el.getAttribute('rel') === 'stylesheet'
		)
	})

	expect(layerDeclarationIndex).toBeGreaterThanOrEqual(0)
	expect(firstStylesheetIndex).toBeGreaterThanOrEqual(0)
	expect(layerDeclarationIndex).toBeLessThan(firstStylesheetIndex)
})
