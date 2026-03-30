import { describe, it, expect } from 'vitest'
import { schema } from '../src/lib/env.server'

describe('env.server schema', () => {
	const VALID_DEV_ENV = {
		BETTER_AUTH_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789',
		BETTER_AUTH_URL: 'http://localhost:3001',
		DATABASE_URL: 'file:data/test.db',
		DATA_DIR: '/tmp/test',
		EMAIL_FROM: 'Hello <hello@example.com>',
		HMAC_SECRET: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
		NODE_ENV: 'development',
	}

	it('parses a valid development environment', () => {
		const result = schema.safeParse(VALID_DEV_ENV)
		expect(result.error).toBeFalsy()
	})

	it('requires key environment variables', () => {
		const result = schema.safeParse({ ...VALID_DEV_ENV, DATABASE_URL: undefined })
		expect(result.error).toBeTruthy()
	})

	it('requires a valid EMAIL_FROM name-addr', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			EMAIL_FROM: 'just.email@example.com',
		})
		expect(result.error).toBeTruthy()
	})

	it('requires EMAIL_PROVIDER=resend in production', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			EMAIL_PROVIDER: 'console',
			NODE_ENV: 'production',
		})
		expect(result.error).toBeTruthy()
	})

	it('namespaces email configuration', () => {
		const result = schema.safeParse(VALID_DEV_ENV)
		expect(result.data?.email.PROVIDER).toBe('console')
	})
})
