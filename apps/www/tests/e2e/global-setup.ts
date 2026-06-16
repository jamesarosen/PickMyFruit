import { chromium, type FullConfig } from '@playwright/test'
import { createClient } from '@libsql/client'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_DB_PATH = resolve(__dirname, '../../data/test.db')

/**
 * Fail loudly if the E2E server is NOT running kokoto in manual dispatch mode.
 * The inquiry flow passes regardless of dispatch mode (handle.result() polls the
 * DB either way), so without this guard the suite would stay green under the
 * auto-mode 1s poll — silently reintroducing the SQLite write-lock contention
 * this setup exists to avoid, now against a reduced 5s busy_timeout. We detect
 * the mode by the executor heartbeat: auto mode advances it every poll; manual
 * mode leaves it frozen while idle. Runs before the warmup enqueues any work.
 */
async function assertManualDispatch(): Promise<void> {
	const client = createClient({ url: `file:${TEST_DB_PATH}` })
	const sleep = (ms: number): Promise<void> =>
		new Promise((resolve) => setTimeout(resolve, ms))
	try {
		const readHeartbeat = async (): Promise<number | null> => {
			const res = await client.execute(
				'SELECT MAX(heartbeat_at) AS hb FROM _dc_executor'
			)
			const hb = res.rows[0]?.hb
			return hb == null ? null : Number(hb)
		}

		// kokoto records its executor row on the first SSR load; the webServer
		// readiness probe already hit /login, so it should exist — retry briefly
		// in case boot is still settling. Recursion (not a loop) keeps the
		// sequential retries clear of the no-await-in-loop rule.
		const waitForHeartbeat = async (attempts: number): Promise<number> => {
			const hb = await readHeartbeat()
			if (hb != null) {
				return hb
			}
			if (attempts <= 0) {
				throw new Error(
					'[global-setup] kokoto recorded no executor row — the runtime did not boot'
				)
			}
			await sleep(200)
			return waitForHeartbeat(attempts - 1)
		}

		const before = await waitForHeartbeat(50)

		// The app polls every 1s in auto mode, so 2s guarantees a tick would land
		// and advance the heartbeat. Nothing is enqueued yet, so manual mode must
		// leave it untouched.
		await sleep(2000)
		const after = await readHeartbeat()
		if (after != null && after !== before) {
			throw new Error(
				`[global-setup] kokoto heartbeat advanced while idle (${before} → ${after}) — ` +
					'the server is in AUTO dispatch mode. E2E requires KOKOTO_DISPATCH=manual ' +
					'(set in playwright.config.ts) to avoid SQLite write-lock contention.'
			)
		}
		console.log(
			'[global-setup] confirmed kokoto manual dispatch (heartbeat idle)'
		)
	} finally {
		client.close()
	}
}

/**
 * Runs after the webServer starts but before any test. First asserts the server
 * is in manual kokoto dispatch (see {@link assertManualDispatch}), then warms up:
 * 1. Client bundles — browser visit to /login and /listings/new triggers Vite
 *    lazy compilation so the first real test doesn't exhaust its timeout.
 * 2. Auth SSR handler — clicking "Send sign-in link" in the browser exercises
 *    the exact same code path the first test uses, including all SSR module
 *    loading that a bare fetch POST does not cover.
 * 3. /listings/new SSR path — browser visit triggers that route's SSR bundle.
 */
export default async function globalSetup(config: FullConfig) {
	const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5174'

	await assertManualDispatch()

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
