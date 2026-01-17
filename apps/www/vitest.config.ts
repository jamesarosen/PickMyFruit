import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
	plugins: [tsconfigPaths(), solid()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./tests/setup.ts'],
		deps: {
			optimizer: {
				web: {
					include: [
						'@solidjs/testing-library',
						'@tanstack/solid-router',
						'@tanstack/solid-start',
						'solid-js',
					],
				},
			},
		},
		server: {
			deps: {
				inline: [/@tanstack/, /solid/],
			},
		},
	},
	resolve: {
		conditions: ['development', 'browser'],
	},
})
