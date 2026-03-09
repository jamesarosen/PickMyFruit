import { createRouter } from '@tanstack/solid-router'
import { tanstackRouterBrowserTracingIntegration } from '@sentry/solid/tanstackrouter'
import { Sentry } from '@/lib/sentry'
import { routeTree } from './routeTree.gen'

export function getRouter() {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
	})

	// Client-only: replace the default browserTracingIntegration with the
	// TanStack Router-aware version so navigation spans use route patterns.
	if (!import.meta.env.SSR) {
		Sentry.addIntegration(tanstackRouterBrowserTracingIntegration(router))
	}

	return router
}
