import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('runMigrations boot gating', () => {
	const originalNodeEnv = process.env.NODE_ENV

	beforeEach(() => {
		vi.resetModules()
	})

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv
		vi.resetModules()
	})

	it('shouldRunBootMigrations is true for development', async () => {
		process.env.NODE_ENV = 'development'
		vi.resetModules()
		const mod = await import('../src/lib/migrations.server')
		expect(mod.shouldRunBootMigrations()).toBe(true)
	})

	it('shouldRunBootMigrations is false for test', async () => {
		process.env.NODE_ENV = 'test'
		vi.resetModules()
		const mod = await import('../src/lib/migrations.server')
		expect(mod.shouldRunBootMigrations()).toBe(false)
	})

	it('runMigrations resolves immediately when NODE_ENV is test', async () => {
		process.env.NODE_ENV = 'test'
		vi.resetModules()
		const { runMigrations } = await import('../src/lib/migrations.server')
		await expect(runMigrations()).resolves.toBeUndefined()
	})
})
