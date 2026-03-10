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
		if (id.includes('/node_modules/h3-js/') && code.includes('__dirname')) {
			return {
				code: code.replaceAll('__dirname', 'import.meta.dirname'),
				map: { mappings: '' },
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
		build: {
			// 'hidden' generates .map files but omits the //# sourceMappingURL= comment,
			// so browsers do not auto-fetch them. sentry-cli (run in the Dockerfile
			// build step after pnpm build) can still locate and upload them by path.
			sourcemap: 'hidden',
		},
		// Enable sourcemaps in the SSR Vite environment so Nitro has source-mapped
		// input when it builds the final server bundle. Without this, server-side
		// error stack traces in Sentry cannot be mapped back to original TypeScript.
		environments: {
			ssr: {
				build: { sourcemap: 'hidden' },
			},
		},
		server: {},
		plugins: [
			tsconfigPaths(),
			tanstackStart(),
			// traceDeps copies @libsql's native binaries into .output/server/node_modules/
			// so the production bundle can resolve them without a full node_modules install.
			// sourcemap: true makes Nitro's Rollup pass emit .map files for the final
			// .output/server bundle and chain them through the SSR sourcemaps above.
			nitro({ sourcemap: true, traceDeps: ['libsql'] }),
			h3jsDirnamePolyfill,
			solid({ ssr: true }),
		],
	}
})
