import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		globals: false,
		hookTimeout: 30_000,
		testTimeout: 30_000,
	},
})
