import { execSync } from 'node:child_process'
import { existsSync, rmSync, truncateSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs as a prelude to the Playwright webServer command, BEFORE Vite opens
// the SQLite database. Putting migrations in Playwright's `globalSetup`
// races with the webServer startup — Vite opens the DB first and locks it,
// so drizzle-kit then fails with SQLITE_BUSY on `CREATE TABLE
// __drizzle_migrations`. Doing the reset+migrate here guarantees the schema
// is in place before the app process ever connects.

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../..')
const testDbPath = resolve(wwwRoot, 'data/test.db')

if (existsSync(testDbPath)) {
	truncateSync(testDbPath, 0)
}
for (const suffix of ['-wal', '-shm']) {
	rmSync(testDbPath + suffix, { force: true })
}

execSync('pnpm db:migrate', {
	cwd: wwwRoot,
	env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
	stdio: 'inherit',
})
