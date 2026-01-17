import { createAuthClient } from 'better-auth/solid'
import { magicLinkClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
	plugins: [magicLinkClient()],
})

// Export commonly used functions and hooks
export const { useSession, signOut } = authClient
export const { magicLink } = authClient
