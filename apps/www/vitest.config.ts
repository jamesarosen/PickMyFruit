import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

export default defineConfig({
	plugins: [tsconfigPaths(), solid()],
	test: {
		environment: 'jsdom',
		globals: true,
		// loadEnv doesn't work in vitest's jsdom environment, so we
		// duplicate .env.test values here for test-time injection.
		// Must stay in sync with baseSchema in env.server.ts and webserver.env in
		// playwright.config.ts
		env: {
			BETTER_AUTH_SECRET: 'test-secret-do-not-use-in-production-min32chars',
			BETTER_AUTH_URL: 'http://localhost:5174',
			DATABASE_URL: 'file:local.db',
			EMAIL_FROM: 'Test <test@example.com>',
			EMAIL_PROVIDER: 'silent',
			HMAC_SECRET: 'test-secret-do-not-use-in-production-min32chars',
		},
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
