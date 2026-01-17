/* eslint-disable jest/no-untyped-mock-factory -- Centralized auth mocks; type safety ensured by vi.mocked() at call sites */
import { vi } from 'vitest'

/**
 * Sets up all auth-related mocks for router integration tests.
 * Must be called before importing any modules that depend on auth.
 */
export function mockAuth() {
	vi.mock('../src/data/db', () => ({
		db: {},
	}))

	vi.mock('../src/data/queries', () => ({
		getUserListings: vi.fn().mockResolvedValue([]),
	}))

	vi.mock('../src/lib/auth', () => ({
		auth: {
			api: {
				getSession: vi.fn().mockResolvedValue(null),
			},
		},
	}))

	vi.mock('../src/lib/session', () => ({
		getSession: vi.fn(),
	}))

	vi.mock('../src/lib/auth-client', () => ({
		authClient: {
			getSession: vi.fn(),
			signIn: {
				magicLink: vi.fn(),
			},
		},
		useSession: () => () => ({ data: null, isPending: false }),
		signOut: vi.fn(),
		magicLink: { signIn: vi.fn() },
	}))
}
