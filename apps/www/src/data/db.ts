import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { Sentry } from '@/lib/sentry'
import * as schema from './schema'
import { serverEnv } from '@/lib/env.server'

const client = createClient({
	url: serverEnv.DATABASE_URL,
	authToken: serverEnv.DATABASE_AUTH_TOKEN,
})

// SQLite does not enforce foreign keys by default; opt in for every connection.
try {
	await client.execute('PRAGMA foreign_keys = ON')
} catch (err) {
	Sentry.captureException(err)
	throw err
}

export const db = drizzle(client, { schema })
