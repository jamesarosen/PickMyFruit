import { faker } from '@faker-js/faker'
import type { Session } from '../src/lib/auth'

/**
 * Creates a mock user object with faker-generated data.
 * Matches the Better Auth user schema.
 */
export function createMockUser(overrides: Partial<Session['user']> = {}) {
	const id = faker.string.uuid()
	return {
		id,
		email: faker.internet.email(),
		name: faker.person.fullName(),
		emailVerified: faker.datatype.boolean(),
		image: faker.datatype.boolean() ? faker.image.avatar() : null,
		createdAt: faker.date.past(),
		updatedAt: faker.date.recent(),
		phone: faker.datatype.boolean() ? faker.phone.number() : null,
		...overrides,
	} satisfies Session['user']
}

/**
 * Creates a mock session record with faker-generated data.
 * Matches the Better Auth session schema.
 */
export function createMockSessionRecord(
	userId: string,
	overrides: Partial<Session['session']> = {}
) {
	return {
		id: faker.string.uuid(),
		userId,
		expiresAt: faker.date.future(),
		ipAddress: faker.internet.ip(),
		userAgent: faker.internet.userAgent(),
		createdAt: faker.date.past(),
		updatedAt: faker.date.recent(),
		token: faker.string.alphanumeric(64),
		...overrides,
	} satisfies Session['session']
}

/**
 * Creates a complete mock session (user + session record).
 * Use this in tests that need to mock authenticated state.
 */
export function createMockSession(
	userOverrides: Partial<Session['user']> = {},
	sessionOverrides: Partial<Session['session']> = {}
): Session {
	const user = createMockUser(userOverrides)
	const session = createMockSessionRecord(user.id, sessionOverrides)
	return { user, session }
}

/**
 * Creates the response shape that authClient.getSession() returns.
 */
export function createAuthClientSessionResponse(session: Session | null) {
	return {
		data: session,
		error: null,
	}
}
