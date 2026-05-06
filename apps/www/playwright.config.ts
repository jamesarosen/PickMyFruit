import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const testDbPath = resolve(__dirname, 'data/test.db')

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
		// Must stay in sync with baseSchema in env.server.ts and test.env in
		// vitest.config.ts.
		// Storage and photos vars are forwarded from process.env so CI can inject
		// LocalStack + photos-service credentials; defaults keep local-only runs working.
		env: {
			BETTER_AUTH_SECRET: 'test-secret-for-e2e-minimum-32-characters',
			BETTER_AUTH_URL: 'http://localhost:5174',
			DATABASE_URL: `file:${testDbPath}`,
			EMAIL_FROM: 'Test <test@example.com>',
			EMAIL_PROVIDER: 'silent',
			HMAC_SECRET: 'test-secret-for-e2e-minimum-32-characters',
			INTERNAL_TOKEN: process.env.INTERNAL_TOKEN ?? 'test-token',
			PHOTOS_BASE_URL: process.env.PHOTOS_BASE_URL ?? 'http://localhost:8080',
			PORT: '5174',
			STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 'memory',
			...(process.env.STORAGE_PROVIDER === 'tigris'
				? {
						AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3!,
						AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID!,
						AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY!,
						BUCKET_NAME: process.env.BUCKET_NAME!,
						MEDIA_ORIGIN: process.env.MEDIA_ORIGIN!,
					}
				: {}),
		},
	},
})
