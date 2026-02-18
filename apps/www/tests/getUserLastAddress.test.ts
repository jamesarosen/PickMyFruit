import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockOrderBy = vi.fn()
const mockLimit = vi.fn()

vi.mock('../src/data/db', () => ({
	db: {
		select: (...args: unknown[]) => {
			mockSelect(...args)
			return { from: mockFrom }
		},
	},
}))

mockFrom.mockReturnValue({ where: mockWhere })
mockWhere.mockReturnValue({ orderBy: mockOrderBy })
mockOrderBy.mockReturnValue({ limit: mockLimit })

// Must import after mocking
const { getUserLastAddress } = await import('../src/data/queries')

describe('getUserLastAddress', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFrom.mockReturnValue({ where: mockWhere })
		mockWhere.mockReturnValue({ orderBy: mockOrderBy })
		mockOrderBy.mockReturnValue({ limit: mockLimit })
	})

	it('returns undefined when user has no listings', async () => {
		mockLimit.mockResolvedValue([])

		const result = await getUserLastAddress(faker.string.uuid())

		expect(result).toBeUndefined()
	})

	it('returns address fields from the most recent listing', async () => {
		const address = {
			address: faker.location.streetAddress(),
			city: 'Napa',
			state: 'CA',
			zip: '94558',
		}
		mockLimit.mockResolvedValue([address])

		const result = await getUserLastAddress(faker.string.uuid())

		expect(result).toEqual(address)
	})

	it('returns address with null zip when zip is not set', async () => {
		const address = {
			address: faker.location.streetAddress(),
			city: 'Napa',
			state: 'CA',
			zip: null,
		}
		mockLimit.mockResolvedValue([address])

		const result = await getUserLastAddress(faker.string.uuid())

		expect(result).toEqual(address)
		expect(result?.zip).toBeNull()
	})
})
