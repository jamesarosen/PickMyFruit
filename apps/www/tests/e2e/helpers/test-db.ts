import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { user, verification } from '../../../src/data/schema'
import { eq, desc, like } from 'drizzle-orm'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../../..')

// Uses same test.db as playwright webServer - absolute path for consistency
const TEST_DB_URL = `file:${resolve(wwwRoot, 'test.db')}`

const TEST_USER = {
	id: 'e2e-test-user',
	email: 'e2e@test.local',
	name: 'E2E Test User',
	emailVerified: true,
	createdAt: new Date(),
	updatedAt: new Date(),
}

function getDb() {
	return drizzle(createClient({ url: TEST_DB_URL }))
}

export async function seedTestUser() {
	const db = getDb()
	await db.delete(user).where(eq(user.id, TEST_USER.id))
	await db.insert(user).values(TEST_USER)
	return TEST_USER
}

export async function getMagicLinkToken(email: string): Promise<string> {
	const db = getDb()
	// Better Auth stores email in 'value' column as JSON: {"email":"..."}
	// The token is in the 'identifier' column
	const valuePattern = `%"email":"${email}"%`

	const queryToken = async () => {
		const result = await db
			.select({ token: verification.identifier })
			.from(verification)
			.where(like(verification.value, valuePattern))
			.orderBy(desc(verification.createdAt))
			.limit(1)
		return result.length ? result[0].token : null
	}

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

	// Poll for token using recursion (server creates it async)
	const poll = async (attempts: number): Promise<string> => {
		const token = await queryToken()
		if (token) {
			return token
		}
		if (attempts <= 0) {
			throw new Error(`No token found for ${email}`)
		}
		await sleep(100)
		return poll(attempts - 1)
	}

	return poll(50)
}

export { TEST_USER }
