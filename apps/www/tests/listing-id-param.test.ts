import { describe, expect, it } from 'vitest'
import { listingIdParamSchema } from '../src/api/listings'
import { NotFoundError } from '../src/lib/user-error'

describe('Listing id param parsing', () => {
	it.each([
		['1', 1],
		['42', 42],
		[42, 42],
		['009', 9],
	])('accepts %s → %s', (input, expected) => {
		expect.hasAssertions()
		expect(listingIdParamSchema.parse(input)).toBe(expected)
	})

	it.each([
		'#main-content',
		'%23main-content',
		'12abc',
		'-1',
		'0',
		0,
		Number.NaN,
		'',
		{},
		null,
		undefined,
	])('rejects %s with NotFoundError', (input) => {
		expect.hasAssertions()
		expect(() => listingIdParamSchema.parse(input)).toThrow(NotFoundError)
	})
})
