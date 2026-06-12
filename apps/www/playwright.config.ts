import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { loadTestEnv } from './tests/helpers/test-env'

const __dirname = dirname(fileURLToPath(import.meta.url))
const testDbPath = resolve(__dirname, 'data/test.db')

export default defineConfig({
	testDir: './tests/e2e',
	globalSetup: './tests/e2e/global-setup.ts',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	// One local retry mirrors CI's tolerance for the SQLite write-lock flake
	// (see Known Issues in CLAUDE.md); genuinely broken tests still fail.
	retries: process.env.CI ? 2 : 1,
	workers: 1, // SQLite doesn't support concurrent writes across test files
	reporter: [
		['html', { open: 'never' }],
		...(process.env.CI ? [['github'] as const] : []),
	],
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		// Reset + migrate the DB BEFORE Vite starts so the dev server does not
		// hold a SQLite write lock while drizzle-kit applies migrations. Doing
		// this in Playwright's globalSetup races with webServer startup —
		// Playwright awaits webServer URL readiness before running globalSetup,
		// by which point Vite has already opened the database.
		command: 'node tests/e2e/setup-db.mjs && pnpm dev',
		url: 'http://localhost:5174/login',
		reuseExistingServer: false, // Always start fresh for isolation
		timeout: 120000,
		stdout: 'pipe',
		stderr: 'pipe',
		// Shared values come from .env.test via loadTestEnv; only
		// runner-specific paths, the port, and E2E feature flags are overridden.
		env: loadTestEnv({
			DATABASE_URL: `file:${testDbPath}`,
			DATA_DIR: resolve(__dirname, 'test-uploads'),
			NODE_ENV: 'test',
			PORT: '5174',
			/** Enables `/root-error` loader to throw into the root error boundary (see `api/e2e-root-error.ts`). */
			E2E_THROW_ROOT_ERROR: '1',
		}),
	},
})
