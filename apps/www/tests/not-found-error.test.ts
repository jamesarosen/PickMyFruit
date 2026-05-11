import { describe, expect, it } from 'vitest'
import { isNotFoundError, NotFoundError } from '../src/lib/user-error'

describe('NotFoundError', () => {
	it('is an Error subclass with name NotFoundError', () => {
		expect.hasAssertions()
		const err = new NotFoundError()
		expect(err).toBeInstanceOf(Error)
		expect(err).toBeInstanceOf(NotFoundError)
		expect(err.name).toBe('NotFoundError')
	})

	it('defaults message to "Not found"', () => {
		expect.hasAssertions()
		expect(new NotFoundError().message).toBe('Not found')
	})

	it('accepts a custom message', () => {
		expect.hasAssertions()
		expect(new NotFoundError('Missing resource').message).toBe('Missing resource')
	})

	it('sets isNotFound so TanStack isNotFound() recognizes it', () => {
		expect.hasAssertions()
		const err = new NotFoundError()
		expect(err.isNotFound).toBe(true)
	})
})

describe('isNotFoundError', () => {
	it('returns true for new NotFoundError()', () => {
		expect.hasAssertions()
		expect(isNotFoundError(new NotFoundError())).toBe(true)
	})

	it('returns true for a plain TanStack-style not-found object', () => {
		expect.hasAssertions()
		expect(isNotFoundError({ isNotFound: true })).toBe(true)
	})

	it('returns false for an ordinary Error', () => {
		expect.hasAssertions()
		expect(isNotFoundError(new Error('oops'))).toBe(false)
	})
})
