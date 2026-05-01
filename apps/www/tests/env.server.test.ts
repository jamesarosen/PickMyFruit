import { describe, it, expect } from 'vitest'
import { schema, computeMediaOrigin } from '../src/lib/env.server'

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

	it('defaults SHARP_CONCURRENCY to 1', () => {
		const result = schema.safeParse(VALID_DEV_ENV)
		expect(result.data?.SHARP_CONCURRENCY).toBe(1)
	})

	it('parses SHARP_CONCURRENCY as a positive integer', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			SHARP_CONCURRENCY: '2',
		})
		expect(result.data?.SHARP_CONCURRENCY).toBe(2)
	})

	it('rejects invalid SHARP_CONCURRENCY values', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			SHARP_CONCURRENCY: '0',
		})
		expect(result.error).toBeTruthy()
	})

	it('accepts optional VITE_MEDIA_ORIGIN as a URL', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			VITE_MEDIA_ORIGIN: 'https://media.pickmyfruit.com',
		})
		expect(result.error).toBeFalsy()
		expect(result.data?.VITE_MEDIA_ORIGIN).toBe('https://media.pickmyfruit.com')
	})

	it('treats empty VITE_MEDIA_ORIGIN as unset', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			VITE_MEDIA_ORIGIN: '',
		})
		expect(result.error).toBeFalsy()
		expect(result.data?.VITE_MEDIA_ORIGIN).toBeUndefined()
	})

	it('computeMediaOrigin is empty for local storage', () => {
		const result = schema.safeParse(VALID_DEV_ENV)
		expect(result.data).toBeTruthy()
		expect(computeMediaOrigin(result.data!)).toBe('')
	})

	it('computeMediaOrigin defaults to the Tigris bucket host when VITE_MEDIA_ORIGIN is unset', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			STORAGE_PROVIDER: 'tigris',
			AWS_ACCESS_KEY_ID: 'a',
			AWS_SECRET_ACCESS_KEY: 'b',
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			BUCKET_NAME: 'my-bucket',
		})
		expect(result.error).toBeFalsy()
		expect(computeMediaOrigin(result.data!)).toBe(
			'https://my-bucket.fly.storage.tigris.dev'
		)
	})

	it('computeMediaOrigin uses VITE_MEDIA_ORIGIN for Tigris when set', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			STORAGE_PROVIDER: 'tigris',
			AWS_ACCESS_KEY_ID: 'a',
			AWS_SECRET_ACCESS_KEY: 'b',
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			BUCKET_NAME: 'my-bucket',
			VITE_MEDIA_ORIGIN: 'https://cdn.example.com',
		})
		expect(result.error).toBeFalsy()
		expect(computeMediaOrigin(result.data!)).toBe('https://cdn.example.com')
	})
})
