/// <reference types="vite/client" />
import * as Solid from 'solid-js'
import {
	Outlet,
	createRootRoute,
	HeadContent,
	Scripts,
	Link,
} from '@tanstack/solid-router'
import { HydrationScript } from 'solid-js/web'
import { getSession } from '@/lib/session'
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
	component: RootComponent,
	notFoundComponent: NotFound,
})

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	)
}

function RootDocument({ children }: Readonly<{ children: Solid.JSX.Element }>) {
	return (
		<html lang="en-US">
			<head>
				<HydrationScript />
			</head>
			<body>
				<HeadContent />
				<Solid.Suspense>{children}</Solid.Suspense>
				<Scripts />
			</body>
		</html>
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
