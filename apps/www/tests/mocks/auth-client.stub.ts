import { vi } from 'vitest'

export const mockVerify = vi.fn()
export const mockSendMagicLink = vi.fn()

vi.mock('@/lib/auth-client', () => ({
	authClient: {
		magicLink: { verify: mockVerify },
		signIn: { magicLink: mockSendMagicLink },
	},
}))
