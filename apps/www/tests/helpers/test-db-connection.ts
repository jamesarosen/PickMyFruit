/**
 * Database connection helpers for tests.
 *
 * Import in individual test files, NOT in setup.ts (which runs in jsdom
 * and cannot load native libsql bindings).
 */

import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { beforeEach, afterEach } from 'vitest'
import * as schema from '../../src/data/schema'
import { setupTestDatabase, type TestDbContext } from './test-db-setup'

/** Convert a database file path to a libsql connection URL. */
export function toLibsqlUrl(dbPath: string): string {
	return `file:${dbPath}`
}

/** Creates a Drizzle database connection for testing. */
export function createTestDbConnection(dbPath: string) {
	const client = createClient({ url: toLibsqlUrl(dbPath) })
	const db = drizzle(client, { schema })

	return {
		client,
		db,
		close() {
			client.close()
		},
	}
}

export type TestDbConnection = ReturnType<typeof createTestDbConnection>

/**
 * Opt-in test database lifecycle. Call at the top of a `describe` block to
 * get a fresh database copy for each test. Returns accessors for the db path
 * and a connected Drizzle instance.
 */
export function useTestDb() {
	let ctx: TestDbContext | null = null
	let conn: TestDbConnection | null = null

	beforeEach((vitestCtx) => {
		ctx = setupTestDatabase(vitestCtx.task.id)
	})

	afterEach(() => {
		try {
			conn?.close()
		} finally {
			conn = null
		}
		try {
			ctx?.cleanup()
		} finally {
			ctx = null
		}
	})

	return {
		/** Returns the file path to the current test's database. */
		getPath() {
			if (!ctx) {
				throw new Error(
					'No test database available. Call getDb()/getPath() inside a test (it/beforeEach/afterEach), not at describe-scope or module level.'
				)
			}
			return ctx.path
		},
		/** Returns a Drizzle connection to the current test's database. Lazily created, auto-closed in afterEach. */
		getDb() {
			if (!ctx) {
				throw new Error(
					'No test database available. Call getDb()/getPath() inside a test (it/beforeEach/afterEach), not at describe-scope or module level.'
				)
			}
			if (!conn) {
				conn = createTestDbConnection(ctx.path)
			}
			return conn.db
		},
	}
}
