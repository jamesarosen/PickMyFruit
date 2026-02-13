import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const testDbPath = resolve(__dirname, 'test.db')

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: 1, // SQLite doesn't support concurrent writes across test files
	reporter: [
		['html', { open: 'never' }],
		...(process.env.CI ? [['github'] as const] : []),
	],
	globalSetup: './tests/e2e/global-setup.ts',
	use: {
		baseURL: 'http://localhost:5174',
		trace: 'on-first-retry',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm dev',
		url: 'http://localhost:5174/login',
		reuseExistingServer: false, // Always start fresh for isolation
		timeout: 120000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			AUTH_LOG_MAGIC_LINK: 'false',
			PORT: '5174',
			DATABASE_URL: `file:${testDbPath}`,
			BETTER_AUTH_SECRET: 'test-secret-for-e2e-minimum-32-characters',
			BETTER_AUTH_URL: 'http://localhost:5174',
		},
	},
})
