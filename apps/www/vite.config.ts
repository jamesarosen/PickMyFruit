import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
	server: {},
	plugins: [tsconfigPaths(), tanstackStart(), nitro(), solid({ ssr: true })],
})
