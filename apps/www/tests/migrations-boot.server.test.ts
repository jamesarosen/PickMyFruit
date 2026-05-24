import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TEST_ENV = {
	BETTER_AUTH_SECRET: 'test-secret-do-not-use-in-production-min32chars',
	BETTER_AUTH_URL: 'http://localhost:5174',
	DATABASE_URL: 'file:data/test.db',
	DATA_DIR: '/tmp/pmf-test',
	EMAIL_FROM: 'Test <test@example.com>',
	EMAIL_PROVIDER: 'silent',
	HMAC_SECRET: 'test-secret-do-not-use-in-production-min32chars',
	NODE_ENV: 'test',
	STORAGE_PROVIDER: 'local',
} as const

describe('runMigrations boot gating', () => {
	const originalEnv = { ...process.env }

	beforeEach(() => {
		vi.resetModules()
	})

	afterEach(() => {
		process.env = { ...originalEnv }
		vi.resetModules()
	})

	it('no-ops when RUN_MIGRATIONS_ON_BOOT is false', async () => {
		process.env = {
			...originalEnv,
			...TEST_ENV,
			RUN_MIGRATIONS_ON_BOOT: 'false',
		}
		vi.resetModules()
		const { runMigrations } = await import('../src/lib/migrations.server')
		await expect(runMigrations()).resolves.toBeUndefined()
	})

	it('no-ops when RUN_MIGRATIONS_ON_BOOT is unset (defaults to false)', async () => {
		process.env = { ...originalEnv, ...TEST_ENV }
		delete process.env.RUN_MIGRATIONS_ON_BOOT
		vi.resetModules()
		const { runMigrations } = await import('../src/lib/migrations.server')
		await expect(runMigrations()).resolves.toBeUndefined()
	})
})
