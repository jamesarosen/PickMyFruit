/**
 * File-system operations for test database isolation.
 *
 * Database connections live in test-db-connection.ts to avoid
 * import issues with vitest's jsdom environment.
 */

import { execSync } from 'node:child_process'
import {
	copyFileSync,
	existsSync,
	unlinkSync,
	mkdirSync,
	readdirSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../..')
const testDbDir = resolve(wwwRoot, '.test-dbs')

/** Path to the "golden" migrated database. */
export const GOLDEN_DB_PATH = resolve(testDbDir, 'golden.db')

/** Get the path for a per-test database. */
export function getTestDbPath(testId: string): string {
	const safeId = testId.replace(/[^a-zA-Z0-9_-]/g, '_')
	return resolve(testDbDir, `test-${safeId}.db`)
}

function ensureTestDbDir(): void {
	mkdirSync(testDbDir, { recursive: true })
}

/** Removes a database file and its SQLite sidecar files. */
function removeDatabaseFiles(dbPath: string): void {
	for (const suffix of ['', '-wal', '-shm', '-journal']) {
		const filePath = dbPath + suffix
		try {
			if (existsSync(filePath)) {
				unlinkSync(filePath)
			}
		} catch (err) {
			const error = new Error(`Failed to remove ${filePath}`)
			;(error as unknown as { cause: unknown }).cause = err
			throw error
		}
	}
}

/** Extracts stdout and stderr from an execSync error. */
function extractExecOutput(err: unknown): string {
	if (!(err instanceof Error)) {
		return ''
	}
	const parts: string[] = []
	if ('stdout' in err) {
		const stdout = String((err as { stdout: Buffer }).stdout).trim()
		if (stdout) {
			parts.push(stdout)
		}
	}
	if ('stderr' in err) {
		const stderr = String((err as { stderr: Buffer }).stderr).trim()
		if (stderr) {
			parts.push(stderr)
		}
	}
	return parts.join('\n')
}

/** Creates the "golden" database with migrations applied. Call once before the test suite. */
export function createGoldenDatabase(): void {
	ensureTestDbDir()
	removeDatabaseFiles(GOLDEN_DB_PATH)

	try {
		execSync('pnpm db:migrate', {
			cwd: wwwRoot,
			env: { ...process.env, DATABASE_URL: `file:${GOLDEN_DB_PATH}` },
			stdio: 'pipe',
			timeout: 30_000,
		})
	} catch (err: unknown) {
		const output = extractExecOutput(err)
		const error = new Error(
			`Failed to create golden test database.\nCommand: pnpm db:migrate\nDatabase: ${GOLDEN_DB_PATH}${output ? `\n\nOutput:\n${output}` : ''}`
		)
		;(error as unknown as { cause: unknown }).cause = err
		throw error
	}
}

/** Removes leftover per-test database files from `.test-dbs/`. */
export function sweepOrphanedTestDbs(): void {
	if (!existsSync(testDbDir)) {
		return
	}
	for (const file of readdirSync(testDbDir)) {
		if (file.startsWith('test-')) {
			try {
				unlinkSync(resolve(testDbDir, file))
			} catch {
				// Best-effort cleanup; file may be locked by another process
			}
		}
	}
}

/** Copies the golden database to a per-test database file. */
export function copyGoldenDatabase(testId: string): string {
	const testDbPath = getTestDbPath(testId)

	if (!existsSync(GOLDEN_DB_PATH)) {
		throw new Error(
			`Golden database not found at ${GOLDEN_DB_PATH}. ` +
				`Run tests via "pnpm test" to ensure globalSetup creates this file.`
		)
	}

	removeDatabaseFiles(testDbPath)
	copyFileSync(GOLDEN_DB_PATH, testDbPath)
	return testDbPath
}

/** Deletes a per-test database file and its sidecars. */
export function cleanupTestDatabase(testId: string): void {
	removeDatabaseFiles(getTestDbPath(testId))
}

/** Full test database context for a single test. */
export interface TestDbContext {
	path: string
	testId: string
	cleanup: () => void
}

/** Sets up a database file for a single test. Returns context with path and cleanup function. */
export function setupTestDatabase(testId: string): TestDbContext {
	const path = copyGoldenDatabase(testId)

	return {
		path,
		testId,
		cleanup() {
			cleanupTestDatabase(testId)
		},
	}
}
