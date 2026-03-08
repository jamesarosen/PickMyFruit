import { createFileRoute, redirect } from '@tanstack/solid-router'

export const Route = createFileRoute('/privacy-policy')({
	beforeLoad: () => {
		throw redirect({ to: '/privacy', statusCode: 301 })
	},
})
