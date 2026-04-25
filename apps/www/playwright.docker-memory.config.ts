import baseConfig from './playwright.config'
import { defineConfig, devices } from '@playwright/test'

const dockerPort = process.env.DOCKER_MEMORY_TEST_PORT ?? '5180'
const dataDir = `${import.meta.dirname}/data/docker-memory`
const testDbPath = `${dataDir}/test.db`

export default defineConfig({
	...baseConfig,
	testMatch: '**/listing-photos.test.ts',
	use: {
		...baseConfig.use,
		baseURL: `http://localhost:${dockerPort}`,
	},
	projects: [{ name: 'docker-memory-chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm vite-node tests/e2e/docker-memory-web-server.ts',
		url: `http://localhost:${dockerPort}/api/health`,
		reuseExistingServer: false,
		timeout: 300000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			BETTER_AUTH_SECRET: 'test-secret-for-e2e-minimum-32-characters',
			BETTER_AUTH_URL: `http://localhost:${dockerPort}`,
			DATABASE_URL: `file:/app/data/test.db`,
			DATA_DIR: '/app/data',
			EMAIL_FROM: 'Test <test@example.com>',
			EMAIL_PROVIDER: 'silent',
			HMAC_SECRET: 'test-secret-for-e2e-minimum-32-characters',
			NODE_ENV: 'test',
			PORT: dockerPort,
			SHARP_CONCURRENCY: '1',
			STORAGE_PROVIDER: 'local',
			PLAYWRIGHT_TEST_DB_PATH: testDbPath,
			DOCKER_MEMORY_TEST_DATA_DIR: dataDir,
		},
	},
})
