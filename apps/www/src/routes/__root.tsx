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
import { PageFooter } from '@/components/PageFooter'
import { getSession } from '@/lib/session'
import { Sentry } from '@/lib/sentry'
import { trackVisualViewport } from '@/lib/visual-viewport'
import '../styles/base.css'
import '../styles/colors.css'
import '../styles/focus.css'
import '../styles/surfaces.css'

export const Route = createRootRoute({
	beforeLoad: async () => {
		const session = await getSession()
		return { session }
	},
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Pick My Fruit' },
			// Open Graph (LinkedIn, NextDoor, Facebook, etc.)
			{ property: 'og:type', content: 'website' },
			{ property: 'og:url', content: 'https://www.pickmyfruit.com' },
			{ property: 'og:site_name', content: 'Pick My Fruit' },
			{ property: 'og:title', content: 'Pick My Fruit' },
			{
				property: 'og:description',
				content:
					'Share your surplus produce with your neighbors. List your lemons, find fresh peaches.',
			},
			{
				property: 'og:image',
				content: 'https://www.pickmyfruit.com/og-image.png',
			},
			{ property: 'og:image:width', content: '2400' },
			{ property: 'og:image:height', content: '1260' },
			{
				property: 'og:image:alt',
				content: 'Pick My Fruit — Stop Watching Your Fruit Rot',
			},
			// Twitter / X card (also used by some other crawlers)
			{ name: 'twitter:card', content: 'summary_large_image' },
			{ name: 'twitter:title', content: 'Pick My Fruit' },
			{
				name: 'twitter:description',
				content:
					'Share your surplus produce with your neighbors. List your lemons, find fresh peaches.',
			},
			{
				name: 'twitter:image',
				content: 'https://www.pickmyfruit.com/og-image.png',
			},
		],
		links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
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
				{/*
				 * Declare layer order before any dynamic <link> or <style> tags so
				 * the cascade priority is always base < components < page < utilities,
				 * regardless of the order in which TanStack Start injects route CSS.
				 * This can use a CSP hash when we want to drop `unsafe-inline`.
				 */}
				<style>@layer base, components, page, utilities;</style>
			</head>
			<body>
				<a href="#main-content" class="skip-link">
					Skip to main content
				</a>
				<HeadContent />
				<Solid.Suspense>{props.children}</Solid.Suspense>
				<Scripts />
			</body>
		</html>
	)
}

function RootComponent() {
	Solid.onMount(() => {
		const dispose = trackVisualViewport()
		Solid.onCleanup(dispose)
	})

	return (
		<>
			<Outlet />
			<PageFooter />
		</>
	)
}

function RootError({ error, reset }: ErrorComponentProps) {
	Solid.onMount(() => {
		Sentry.captureException(error)
	})

	return (
		<div id="main-content" style={{ padding: '40px', 'text-align': 'center' }}>
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
		<div id="main-content" style={{ padding: '40px', 'text-align': 'center' }}>
			<h1>Page Not Found</h1>
			<p>The page you're looking for doesn't exist.</p>
			<Link to="/">Go Home</Link>
		</div>
	)
}
