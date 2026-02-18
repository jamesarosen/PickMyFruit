import { createAuthClient } from 'better-auth/solid'
import { magicLinkClient } from 'better-auth/client/plugins'
import { Sentry } from './sentry'

export const authClient = createAuthClient({
	plugins: [magicLinkClient()],
})

// Session state: use useRouteContext({ from: '__root__' }).session in components.
// Do not re-export useSession — it bypasses route context and causes hydration bugs.
export const { signOut } = authClient
export const { magicLink } = authClient

/** Signs out and refreshes route data so UI reflects logged-out state. */
export async function performSignOut(router: {
	invalidate: () => Promise<void>
}): Promise<void> {
	try {
		await signOut()
	} catch (error) {
		Sentry.captureException(error)
	}
	await router.invalidate()
}
