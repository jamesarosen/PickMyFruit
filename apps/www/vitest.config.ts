import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

const dbPath = path.resolve(__dirname, 'data', 'test.db')

export default defineConfig({
	plugins: [tsconfigPaths(), solid()],
	test: {
		environment: 'jsdom',
		globals: true,
		globalSetup: ['./tests/vitest-global-setup.ts'],
		setupFiles: ['./tests/setup.ts'],
		exclude: ['**/node_modules/**', '**/tests/e2e/**'],
		deps: {
			optimizer: {
				web: {
					include: [
						'@solidjs/testing-library',
						'@tanstack/solid-router',
						'solid-js',
					],
				},
			},
		},
		projects: [
			{
				// Project for server-side Node.js logic
				extends: true,
				test: {
					name: 'node-tests',
					include: [
						'tests/**/*.server.test.ts',
						'!tests/helpers/**',
						'!tests/mocks/**',
						'!tests/setup.ts',
						'!tests/vitest-global-setup.ts',
					],
					environment: 'node',
					// loadEnv doesn't work in vitest's jsdom environment, so we
					// duplicate .env.test values here for test-time injection.
					// Must stay in sync with baseSchema in env.server.ts and webserver.env in
					// playwright.config.ts
					env: {
						BETTER_AUTH_SECRET: 'test-secret-do-not-use-in-production-min32chars',
						BETTER_AUTH_URL: 'http://localhost:5174',
						DATA_DIR: '/tmp/pmf-test',
						DATABASE_URL: `file:${dbPath}`,
						EMAIL_FROM: 'Test <test@example.com>',
						EMAIL_PROVIDER: 'silent',
						HMAC_SECRET: 'test-secret-do-not-use-in-production-min32chars',
						NODE_ENV: 'test',
						STORAGE_PROVIDER: 'local',
					},
				},
			},
			{
				// Project for isomorphic or browser-only logic
				extends: true,
				test: {
					name: 'browser-tests',
					include: [
						'tests/**/*.{ts,tsx}',
						'!tests/**/*.server.test.ts',
						'!tests/helpers/**',
						'!tests/mocks/**',
						'!tests/setup.ts',
						'!tests/vitest-global-setup.ts',
					],
					environment: 'jsdom',
				},
			},
		],
		server: {
			deps: {
				inline: [/@tanstack\/solid-router/, /solid/],
			},
		},
	},
	resolve: {
		conditions: ['development', 'browser'],
		alias: {
			// Mock TanStack Start server modules that require build environment
			// More specific path must come first
			'@tanstack/solid-start/server': path.resolve(
				__dirname,
				'tests/mocks/tanstack-solid-start-server.ts'
			),
			'@tanstack/solid-start': path.resolve(
				__dirname,
				'tests/mocks/tanstack-solid-start.ts'
			),
		},
	},
})
