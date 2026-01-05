/// <reference types="vite/client" />
import * as Solid from 'solid-js'
import {
	Outlet,
	createRootRoute,
	HeadContent,
	Scripts,
} from '@tanstack/solid-router'
import { HydrationScript } from 'solid-js/web'
import '../styles/base.css'
import '../styles/colors.css'
import '../styles/focus.css'
import '../styles/surfaces.css'

export const Route = createRootRoute({
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
