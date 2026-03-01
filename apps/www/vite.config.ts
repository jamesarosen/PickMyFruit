import { defineConfig, loadEnv } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import solid from 'vite-plugin-solid'

// h3-js is an Emscripten-generated bundle that uses `__dirname` to locate its
// WASM initializer. When Nitro bundles it as ESM, `__dirname` is undefined.
// The WASM is inlined as a base64 data URI so the path is never actually used,
// but the reference still throws at module load. Replace it with the ESM
// equivalent (`import.meta.dirname`, available in Node.js 21.2+).
const h3jsDirnamePolyfill = {
	name: 'h3js-dirname-polyfill',
	transform(code: string, id: string) {
		if (id.includes('h3-js') && code.includes('__dirname')) {
			return {
				code: code.replaceAll('__dirname', 'import.meta.dirname'),
				map: null,
			}
		}
	},
}

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
		plugins: [
			tsconfigPaths(),
			tanstackStart(),
			nitro(),
			h3jsDirnamePolyfill,
			solid({ ssr: true }),
		],
	}
})
