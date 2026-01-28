/**
 * Mock for @tanstack/solid-start in test environment.
 * The real module requires the TanStack Start build environment.
 */

import { vi } from 'vitest'

// Mock createMiddleware to return a chainable object
export function createMiddleware() {
	return {
		server: vi.fn(() => ({
			_types: undefined,
		})),
	}
}

// Mock createIsomorphicFn
export function createIsomorphicFn() {
	const fn = vi.fn()
	return {
		server: vi.fn(() => ({
			client: vi.fn(() => fn),
		})),
		client: vi.fn(() => ({
			server: vi.fn(() => fn),
		})),
	}
}

// Mock createServerFn - returns a chainable builder
export function createServerFn(_options?: { method?: string }) {
	const handler = vi.fn()
	const builder = {
		middleware: vi.fn(() => builder),
		inputValidator: vi.fn(() => builder),
		handler: vi.fn((fn) => {
			handler.mockImplementation(fn)
			return handler
		}),
	}
	return builder
}
