import { test, expect } from './helpers/fixtures'

/**
 * Covers the root `errorComponent` (not listing `notFoundComponent`).
 * We assert stable DOM instead of stubbing Sentry: duplicate capture during
 * error UI render would surface as a broken tree or secondary error boundary.
 */
test.describe('Root error boundary', () => {
	test('shows site chrome when a route loader throws (E2E probe)', async ({
		page,
	}) => {
		await page.goto('/e2e/root-error')

		await expect(
			page.getByRole('heading', { level: 1, name: 'Something went wrong' })
		).toBeVisible()
		await expect(page.locator('.root-fallback-lede')).toHaveText(
			'E2E intentional root error boundary'
		)

		const siteNav = page.getByRole('navigation', { name: 'Site' })
		await expect(
			siteNav.getByRole('link', { name: /Pick My Fruit/i })
		).toBeVisible()

		await siteNav.getByRole('link', { name: /Pick My Fruit/i }).click()
		await expect(page).toHaveURL('/')
		await expect(page.getByRole('navigation', { name: 'Site' })).toBeVisible()
	})

	test('footer remains usable from the root error boundary', async ({
		page,
	}) => {
		await page.goto('/e2e/root-error')
		await page
			.getByRole('contentinfo')
			.getByRole('link', { name: 'About' })
			.click()
		await expect(page).toHaveURL('/about')
	})
})

test.describe('Root not-found layout', () => {
	test('renders exactly one global footer on unknown paths', async ({
		page,
	}) => {
		await page.goto('/foo/bar/baz')
		await expect(
			page.getByRole('heading', { level: 1, name: 'Page Not Found' })
		).toBeVisible()
		await expect(page.locator('footer.page-footer')).toHaveCount(1)
	})
})
