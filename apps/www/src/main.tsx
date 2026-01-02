/* @refresh reload */
import { render } from 'solid-js/web'
import { RouterProvider, createRouter } from '@tanstack/solid-router'
import { routeTree } from './routeTree.gen'

import '@/styles/base.css'
import '@/styles/colors.css'
import '@/styles/focus.css'

const router = createRouter({ routeTree })

declare module '@tanstack/solid-router' {
	interface Register {
		router: typeof router
	}
}

const root = document.getElementById('app')

if (!root) {
	throw new Error('Root element not found')
}

render(() => <RouterProvider router={router} />, root)
