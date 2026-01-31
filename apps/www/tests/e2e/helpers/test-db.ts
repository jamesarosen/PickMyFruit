import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { user, verification, listings } from '../../../src/data/schema'
import { eq, desc, like } from 'drizzle-orm'
import { faker } from '@faker-js/faker'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../../..')

// Uses same test.db as playwright webServer - absolute path for consistency
const TEST_DB_URL = `file:${resolve(wwwRoot, 'test.db')}`

export interface TestUser {
	id: string
	email: string
	name: string
	emailVerified: boolean
	createdAt: Date
	updatedAt: Date
}

function getDb() {
	return drizzle(createClient({ url: TEST_DB_URL }))
}

export function generateTestUser(): TestUser {
	const id = faker.string.uuid()
	return {
		id,
		email: `e2e-${id}@test.local`,
		name: faker.person.fullName(),
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}

export async function createTestUser(testUser?: TestUser): Promise<TestUser> {
	const db = getDb()
	const userToCreate = testUser ?? generateTestUser()
	await db.insert(user).values(userToCreate)
	return userToCreate
}

export async function cleanupTestUser(testUser: TestUser): Promise<void> {
	const db = getDb()
	const valuePattern = `%"email":"${testUser.email}"%`
	await db.delete(verification).where(like(verification.value, valuePattern))
	await db.delete(listings).where(eq(listings.userId, testUser.id))
	await db.delete(user).where(eq(user.id, testUser.id))
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
