import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import solid from 'vite-plugin-solid'

export default defineConfig(({ command, mode }) => {
	if (command === 'serve') {
		// Merge .env.[mode] files into process.env so server-side modules
		// (which read process.env directly) see the same values as the client.
		// Real process.env values take precedence over file values.
		const fileEnv = loadEnv(mode, process.cwd(), '')
		for (const [key, value] of Object.entries(fileEnv)) {
			process.env[key] ??= value
		}
	}

	return {
		server: {},
		plugins: [tsconfigPaths(), tanstackStart(), nitro(), solid({ ssr: true })],
	}
})
