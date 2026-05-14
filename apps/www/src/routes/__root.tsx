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
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { PageFooter } from '@/components/PageFooter'
import { getSession } from '@/lib/session'
import { Sentry } from '@/lib/sentry'
import './__root-fallback.css'
import '../styles/base.css'
import '../styles/colors.css'
import '../styles/focus.css'
import '../styles/surfaces.css'
import '../components/button.css'
import '../components/badge.css'

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
		<Layout title="Something went wrong - Pick My Fruit">
			<div class="root-fallback-page">
				<PageHeader />
				<main id="main-content" class="root-fallback-main">
					<h1>Something went wrong</h1>
					<p class="root-fallback-lede">{error.message}</p>
					<button type="button" class="button button--primary" onClick={reset}>
						Try again
					</button>
				</main>
				<PageFooter />
			</div>
		</Layout>
	)
}

function NotFound() {
	return (
		<Layout title="Page Not Found - Pick My Fruit">
			<div class="root-fallback-page">
				<PageHeader />
				<main id="main-content" class="root-fallback-main">
					<h1>Page Not Found</h1>
					<p class="root-fallback-lede">
						The page you're looking for doesn't exist.
					</p>
					<Link to="/" class="button button--primary">
						Go Home
					</Link>
				</main>
				{/*
				 * Root `notFoundComponent` renders inside `RootComponent`’s `<Outlet />`;
				 * `RootComponent` already appends `<PageFooter />`, so omit it here to avoid
				 * a double footer on unknown paths (e.g. `/foo/bar/baz`).
				 */}
			</div>
		</Layout>
	)
}
