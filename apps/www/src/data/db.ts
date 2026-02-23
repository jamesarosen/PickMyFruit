import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from './schema'
import { serverEnv } from '@/lib/env.server'

const client = createClient({
	url: serverEnv.DATABASE_URL,
	authToken: serverEnv.DATABASE_AUTH_TOKEN,
})

export const db = drizzle(client, { schema })
