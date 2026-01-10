import { createFileRoute, Outlet, redirect } from '@tanstack/solid-router'

export const Route = createFileRoute('/my')({
	beforeLoad: async ({ context }) => {
		// Server-side session check
		const headers = (context as { request?: { headers?: Headers } })?.request
			?.headers
		if (!headers) {
			// Client-side navigation - let the page handle auth
			return {}
		}

		// Dynamic import to avoid bundling server-only code for browser
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw redirect({
				to: '/',
				search: { auth: 'required' },
			})
		}

		return { session }
	},
	component: MyLayout,
})

function MyLayout() {
	return <Outlet />
}
