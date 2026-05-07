import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { Sentry } from '@/lib/sentry'
import * as schema from './schema'
import { serverEnv } from '@/lib/env.server'

const client = createClient({
	url: serverEnv.DATABASE_URL,
	authToken: serverEnv.DATABASE_AUTH_TOKEN,
})

try {
	// Foreign keys are off by default; enable for every connection.
	await client.execute('PRAGMA foreign_keys = ON')
	// WAL allows concurrent reads + a single writer with far less lock
	// contention than the default rollback journal — critical when the e2e
	// suite opens a second connection from test-db.ts to seed/teardown data.
	await client.execute('PRAGMA journal_mode = WAL')
	// Wait up to 5s for a write lock instead of failing immediately with
	// SQLITE_BUSY when another connection is mid-write.
	await client.execute('PRAGMA busy_timeout = 5000')
} catch (err) {
	Sentry.captureException(err)
	throw err
}

export const db = drizzle(client, { schema })
