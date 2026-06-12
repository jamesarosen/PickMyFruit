import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import path from 'node:path'
import { loadTestEnv } from './tests/helpers/test-env'

const dbPath = path.resolve(__dirname, 'data', 'test.db')

export default defineConfig({
	plugins: [solid()],
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
					// Shared values come from .env.test via loadTestEnv; only
					// runner-specific paths are overridden here.
					env: loadTestEnv({
						DATABASE_URL: `file:${dbPath}`,
						DATA_DIR: '/tmp/pmf-test',
						NODE_ENV: 'test',
					}),
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
				inline: [
					/@tanstack\/solid-router/,
					/solid/,
					// @libsql/client's node entry transitively imports `ws` (CJS),
					// and the chain hrana-client → ws fails Node's strict ESM named
					// import. Forcing vite to transform these packages restores the
					// CJS-named-export interop test files rely on.
					/ws/,
					/@libsql/,
					/drizzle-orm/,
				],
			},
		},
	},
	resolve: {
		conditions: ['development', 'browser'],
		tsconfigPaths: true,
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
