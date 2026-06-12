import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	user,
	verification,
	listings,
	inquiries,
	addressReveals,
	type NewListing,
} from '../../../src/data/schema.server'
import { eq, desc, like } from 'drizzle-orm'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../../..')

// Uses same test.db as playwright webServer - absolute path for consistency
const TEST_DB_URL = `file:${resolve(wwwRoot, 'data/test.db')}`

export interface TestUser {
	id: string
	email: string
	name: string
	emailVerified: boolean
	createdAt: Date
	updatedAt: Date
}

const client = createClient({ url: TEST_DB_URL })
// Mirror the pragmas set on the app's connection in db.server.ts so this
// second connection (used by fixtures for seeding/teardown) cooperates with
// the dev server under WAL instead of fighting it for a write lock.
// busy_timeout MUST be set before journal_mode — switching journal mode
// requires an exclusive lock, and without busy_timeout the PRAGMA fails
// immediately with SQLITE_BUSY when the dev server is mid-write.
//
// 30s (vs. the 5s app default) gives the test fixture plenty of headroom
// to outwait kokoto's dispatcher poll: every poll briefly acquires a write
// lock via `BEGIN IMMEDIATE`, and on slow CI hardware those polls can
// overlap with fixture writes often enough to exhaust a 5s budget.
await client.execute('PRAGMA busy_timeout = 30000')
await client.execute('PRAGMA foreign_keys = ON')
await client.execute('PRAGMA journal_mode = WAL')
const db = drizzle(client)

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
	const userToCreate = testUser ?? generateTestUser()
	await db.insert(user).values(userToCreate)
	return userToCreate
}

export async function getUserByEmail(email: string): Promise<TestUser | null> {
	const rows = await db.select().from(user).where(eq(user.email, email)).limit(1)
	return rows.length ? (rows[0] as TestUser) : null
}

export async function cleanupTestUser(testUser: TestUser): Promise<void> {
	// verification has no FK cascade to user, so clean up manually
	const valuePattern = `%"email":"${testUser.email}"%`
	await db.delete(verification).where(like(verification.value, valuePattern))
	// Listings and inquiries cascade-delete from user deletion
	await db.delete(user).where(eq(user.id, testUser.id))
}

export async function getMagicLinkToken(email: string): Promise<string> {
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

	// Poll for token using recursion (server creates it async). The budget is
	// generous because the dev server occasionally holds the SQLite write lock
	// for tens of seconds (see Known Issues in CLAUDE.md), delaying the insert.
	const poll = async (attempts: number): Promise<string> => {
		const token = await queryToken()
		if (token) {
			return token
		}
		if (attempts <= 0) {
			throw new Error(`No token found for ${email}`)
		}
		await sleep(250)
		return poll(attempts - 1)
	}

	return poll(120)
}

export interface TestListing {
	id: number
	name: string
	type: string
	variety: string | null
	status: string
	city: string
	state: string
	userId: string
}

/** Inserts a listing into the test DB and returns it. */
export async function createTestListing(
	userId: string,
	overrides: Partial<NewListing> = {}
): Promise<TestListing> {
	const lat = 38.3
	const lng = -122.3
	const data: NewListing = {
		name: `${faker.person.firstName()}'s fig tree`,
		type: 'fig',
		variety: 'Black Mission',
		status: 'available',
		quantity: 'abundant',
		harvestWindow: 'June-September',
		address: faker.location.streetAddress(),
		city: 'Napa',
		state: 'CA',
		zip: '94558',
		lat,
		lng,
		h3Index: latLngToCell(lat, lng, 13),
		userId,
		notes: null,
		accessInstructions: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
	const result = await db.insert(listings).values(data).returning()
	return result[0]
}

/** Inserts an inquiry into the test DB and returns it. */
export async function createTestInquiry(
	listingId: number,
	gleanerId: string,
	note: string | null = null
) {
	const result = await db
		.insert(inquiries)
		.values({
			listingId,
			gleanerId,
			note,
			createdAt: new Date(),
			emailSentAt: new Date(),
		})
		.returning()
	return result[0]
}

/** Sets a listing's status directly in the test DB. */
export async function setListingStatus(
	listingId: number,
	status: 'available' | 'unavailable'
): Promise<void> {
	await db.update(listings).set({ status }).where(eq(listings.id, listingId))
}

/** Queries address-reveal rows for a given listing from the test DB. */
export async function getAddressRevealsForListing(listingId: number): Promise<
	Array<{
		id: number
		userId: string
		listingId: number
		createdAt: Date
	}>
> {
	return db
		.select()
		.from(addressReveals)
		.where(eq(addressReveals.listingId, listingId))
}

/** Queries inquiries for a given listing from the test DB. */
export async function getInquiriesForListing(listingId: number): Promise<
	Array<{
		id: number
		gleanerId: string
		note: string | null
		emailSentAt: Date | null
	}>
> {
	return db
		.select({
			id: inquiries.id,
			gleanerId: inquiries.gleanerId,
			note: inquiries.note,
			emailSentAt: inquiries.emailSentAt,
		})
		.from(inquiries)
		.where(eq(inquiries.listingId, listingId))
}
