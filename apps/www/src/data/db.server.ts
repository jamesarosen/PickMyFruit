import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { Sentry } from '@/lib/sentry'
import * as schema from './schema.server'
import { serverEnv } from '@/lib/env.server'

/**
 * Underlying libsql client. Exported so server-only packages that need a raw
 * `Client` (e.g. `@pickmyfruit/kokoto`) can share this process's connection
 * pool instead of opening their own.
 */
export const libsqlClient = createClient({
	url: serverEnv.DATABASE_URL,
	authToken: serverEnv.DATABASE_AUTH_TOKEN,
})

try {
	// busy_timeout must be set first — switching journal_mode requires an
	// exclusive lock, and without busy_timeout that PRAGMA fails immediately
	// with SQLITE_BUSY when another connection is mid-write.
	await libsqlClient.execute('PRAGMA busy_timeout = 5000')
	// Foreign keys are off by default; enable for every connection.
	await libsqlClient.execute('PRAGMA foreign_keys = ON')
	// WAL allows concurrent reads + a single writer with far less lock
	// contention than the default rollback journal — critical when the e2e
	// suite opens a second connection from test-db.ts to seed/teardown data.
	await libsqlClient.execute('PRAGMA journal_mode = WAL')
} catch (err) {
	Sentry.captureException(err)
	throw err
}

export const db = drizzle(libsqlClient, { schema })
