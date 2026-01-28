import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

export default defineConfig({
	plugins: [tsconfigPaths(), solid()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		exclude: ['**/node_modules/**', '**/tests/e2e/**'],
		env: {
			AUTH_LOG_MAGIC_LINK: 'false',
		},
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
