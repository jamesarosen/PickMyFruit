import { describe, it, expect } from 'vitest'
import { schema } from '../src/lib/env.server'

describe('env.server schema', () => {
	const VALID_DEV_ENV = {
		BETTER_AUTH_SECRET: 'abcdefghijklmnopqrstuvwxyz0123456789',
		BETTER_AUTH_URL: 'http://localhost:3001',
		DATABASE_URL: 'file:data/test.db',
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

	it('parses with optional MEDIA_ORIGIN when storage is memory (MEDIA_ORIGIN is ignored)', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			MEDIA_ORIGIN: 'https://media.pickmyfruit.com',
		})
		expect(result.error).toBeFalsy()
		expect(result.data?.storage.PROVIDER).toBe('memory')
		expect('mediaOrigin' in result.data!.storage).toBe(false)
	})

	it('treats empty MEDIA_ORIGIN as unset for tigris mediaOrigin default', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			STORAGE_PROVIDER: 'tigris',
			AWS_ACCESS_KEY_ID: 'a',
			AWS_SECRET_ACCESS_KEY: 'b',
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			BUCKET_NAME: 'my-bucket',
			MEDIA_ORIGIN: '',
		})
		expect(result.error).toBeFalsy()
		if (result.data?.storage.PROVIDER !== 'tigris')
			throw new Error('expected tigris')
		expect(result.data.storage.mediaOrigin).toBe(
			'https://my-bucket.fly.storage.tigris.dev'
		)
	})

	it('memory storage has no mediaOrigin property', () => {
		const result = schema.safeParse(VALID_DEV_ENV)
		expect(result.data).toBeTruthy()
		expect(result.data!.storage.PROVIDER).toBe('memory')
		expect('mediaOrigin' in result.data!.storage).toBe(false)
	})

	it('tigris storage defaults mediaOrigin to the bucket CDN host', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			STORAGE_PROVIDER: 'tigris',
			AWS_ACCESS_KEY_ID: 'a',
			AWS_SECRET_ACCESS_KEY: 'b',
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			BUCKET_NAME: 'my-bucket',
		})
		expect(result.error).toBeFalsy()
		if (result.data?.storage.PROVIDER !== 'tigris')
			throw new Error('expected tigris')
		expect(result.data.storage.mediaOrigin).toBe(
			'https://my-bucket.fly.storage.tigris.dev'
		)
	})

	it('tigris storage uses MEDIA_ORIGIN for mediaOrigin when set', () => {
		const result = schema.safeParse({
			...VALID_DEV_ENV,
			STORAGE_PROVIDER: 'tigris',
			AWS_ACCESS_KEY_ID: 'a',
			AWS_SECRET_ACCESS_KEY: 'b',
			AWS_ENDPOINT_URL_S3: 'https://fly.storage.tigris.dev',
			BUCKET_NAME: 'my-bucket',
			MEDIA_ORIGIN: 'https://cdn.example.com',
		})
		expect(result.error).toBeFalsy()
		if (result.data?.storage.PROVIDER !== 'tigris')
			throw new Error('expected tigris')
		expect(result.data.storage.mediaOrigin).toBe('https://cdn.example.com')
	})
})
