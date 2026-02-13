import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { existsSync, rmSync, truncateSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../..')
const testDbPath = resolve(wwwRoot, 'test.db')

export default async function globalSetup() {
	// Truncate (don't delete!) the DB file so the inode is preserved.
	// Deleting causes SQLITE_READONLY_DBMOVED if any process still holds
	// a file descriptor to the old inode. A zero-byte file is treated by
	// SQLite as a fresh empty database.
	if (existsSync(testDbPath)) {
		truncateSync(testDbPath, 0)
	}
	for (const suffix of ['-wal', '-shm']) {
		rmSync(testDbPath + suffix, { force: true })
	}

	// Apply all migrations from scratch on the empty database
	execSync('pnpm db:migrate', {
		cwd: wwwRoot,
		env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
		stdio: 'inherit',
	})
	// Test users are now created per-test in beforeEach hooks
}
