/// <reference types="vite/client" />
import * as Solid from 'solid-js'
import {
	Outlet,
	createRootRoute,
	HeadContent,
	Scripts,
	Link,
	type ErrorComponentProps,
} from '@tanstack/solid-router'
import { HydrationScript } from 'solid-js/web'
import { getSession } from '@/lib/session'
import { Sentry } from '@/lib/sentry'
import '../styles/base.css'
import '../styles/colors.css'
import '../styles/focus.css'
import '../styles/surfaces.css'

export const Route = createRootRoute({
	beforeLoad: async ({ context }) => {
		const session = await getSession(context)
		return { session }
	},
	head: () => ({
		meta: [
			{
				charSet: 'utf-8',
			},
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1',
			},
			{
				title: 'Pick My Fruit',
			},
		],
	}),
	shellComponent: RootShell,
	component: RootComponent,
	errorComponent: RootError,
	notFoundComponent: NotFound,
})

function RootShell(props: { children: Solid.JSX.Element }) {
	return (
		<html lang="en-US">
			<head>
				<HydrationScript />
			</head>
			<body>
				<HeadContent />
				<Solid.Suspense>{props.children}</Solid.Suspense>
				<Scripts />
			</body>
		</html>
	)
}

function RootComponent() {
	return <Outlet />
}

function RootError({ error, reset }: ErrorComponentProps) {
	Solid.onMount(() => {
		Sentry.captureException(error)
	})

	return (
		<div style={{ padding: '40px', 'text-align': 'center' }}>
			<h1>Something went wrong</h1>
			<p style={{ color: 'var(--color-text-muted)', margin: '16px 0' }}>
				{error.message}
			</p>
			<button
				onClick={reset}
				style={{
					padding: '8px 16px',
					'background-color': 'var(--color-primary)',
					color: 'white',
					border: 'none',
					'border-radius': '4px',
					cursor: 'pointer',
				}}
			>
				Try again
			</button>
		</div>
	)
}

function NotFound() {
	return (
		<div style={{ padding: '40px', 'text-align': 'center' }}>
			<h1>Page Not Found</h1>
			<p>The page you're looking for doesn't exist.</p>
			<Link to="/">Go Home</Link>
		</div>
	)
}
