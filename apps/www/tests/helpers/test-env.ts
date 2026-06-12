import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function parseDotenv(file: string): Record<string, string> {
	const env: Record<string, string> = {}
	for (const line of readFileSync(file, 'utf8').split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq === -1) continue
		env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
	}
	return env
}

/**
 * Loads `.env.test` (plus gitignored `.env.test.local` overrides) for test
 * runner configs, so Vitest and Playwright share one source of truth. Pass
 * overrides only for values that genuinely differ per runner (absolute DB
 * paths, ports, feature flags).
 */
export function loadTestEnv(
	overrides: Record<string, string> = {}
): Record<string, string> {
	const env = parseDotenv(resolve(appRoot, '.env.test'))
	const local = resolve(appRoot, '.env.test.local')
	if (existsSync(local)) Object.assign(env, parseDotenv(local))
	return { ...env, ...overrides }
}
