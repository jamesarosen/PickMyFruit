import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { fileURLToPath, URL } from 'node:url'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
	plugins: [
		TanStackRouterVite({
			target: 'solid',
			autoCodeSplitting: true,
		}),
		solid(),
	],
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
})
