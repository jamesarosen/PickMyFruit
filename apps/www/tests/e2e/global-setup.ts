import { chromium, type FullConfig } from '@playwright/test'

/**
 * Runs after the webServer starts but before any test. Warms up three things:
 * 1. Client bundles — browser visit to /login and /listings/new triggers Vite
 *    lazy compilation so the first real test doesn't exhaust its timeout.
 * 2. Auth SSR handler — clicking "Send sign-in link" in the browser exercises
 *    the exact same code path the first test uses, including all SSR module
 *    loading that a bare fetch POST does not cover.
 * 3. /listings/new SSR path — browser visit triggers that route's SSR bundle.
 */
export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5174'

	const browser = await chromium.launch()
	try {
		// Warm up /login and trigger the auth SSR handler via the full browser flow.
		const loginPage = await browser.newPage()
		await loginPage.goto(`${baseURL}/login`, { waitUntil: 'networkidle' })
		await loginPage.getByLabel(/email/i).fill('warmup@example.com')
		const authResponse = loginPage.waitForResponse(
			(r) => r.url().includes('/api/auth/sign-in/magic-link'),
			{ timeout: 90_000 }
		)
		await loginPage.getByRole('button', { name: /send sign-in link/i }).click()
		const res = await authResponse
		console.log(
			`[global-setup] browser warm-up of /login + auth complete (${res.status()})`
		)
		await loginPage.close()

		// Warm up /listings/new SSR bundle separately.
		const newPage = await browser.newPage()
		await newPage.goto(`${baseURL}/listings/new`, { waitUntil: 'networkidle' })
		console.log('[global-setup] browser warm-up of /listings/new complete')
		await newPage.close()
	} finally {
		await browser.close()
	}
}
