import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GOLDEN_DB_PATH } from './helpers/test-db-setup'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '..')

/**
 * All application tables that must exist after every migration has run.
 * Keep this list in sync with schema.ts. The query uses ORDER BY name, so
 * this list must also be sorted alphabetically for the equality check.
 */
const EXPECTED_TABLES = [
	'account',
	'inquiries',
	'listing_photos',
	'listings',
	'notification_subscriptions',
	'session',
	'user',
	'verification',
]

/**
 * Query sqlite_master in a child process to work around the ESM/CJS conflict
 * between @libsql/client and the `ws` package inside vitest's module system.
 */
function queryTables(dbPath: string): string[] {
	const script = `
		import { createClient } from '@libsql/client'
		const client = createClient({ url: process.env.CHECK_DB_URL })
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '__*' ORDER BY name"
		)
		process.stdout.write(JSON.stringify(result.rows.map(r => String(r[0]))))
		client.close()
	`
	const output = execSync('node --input-type=module', {
		cwd: wwwRoot,
		input: script,
		env: { ...process.env, CHECK_DB_URL: `file:${dbPath}` },
		encoding: 'utf8',
		timeout: 15_000,
	})
	return JSON.parse(output) as string[]
}

describe('database migrations', () => {
	it('golden database has all expected tables after migrations run', () => {
		// The golden DB is created by vitest globalSetup (createGoldenDatabase) before
		// any test runs. Querying it here asserts that the migration outcome is correct —
		// something globalSetup does not check — without paying the cost of a second
		// migration run.
		const tables = queryTables(GOLDEN_DB_PATH)
		expect(tables).toEqual(EXPECTED_TABLES)
	})

	it('journal when values are strictly increasing by idx', () => {
		const journalPath = resolve(wwwRoot, 'drizzle', 'meta', '_journal.json')
		const journal = JSON.parse(readFileSync(journalPath, 'utf8'))
		const entries: Array<{ idx: number; when: number; tag: string }> =
			journal.entries

		for (let i = 1; i < entries.length; i++) {
			const prev = entries[i - 1]
			const curr = entries[i]
			expect(
				curr.when,
				`${curr.tag} (idx ${curr.idx}, when=${curr.when}) must be > ${prev.tag} (idx ${prev.idx}, when=${prev.when})`
			).toBeGreaterThan(prev.when)
		}
	})
})
