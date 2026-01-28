/**
 * Mock for @tanstack/solid-start/server in test environment.
 * The real module requires the TanStack Start build environment.
 */

import { vi } from 'vitest'

// Mock getRequestHeaders
export const getRequestHeaders = vi.fn(() => new Headers())

// Mock getRequest
export const getRequest = vi.fn(() =>
	Promise.resolve({
		headers: new Headers(),
		url: 'http://localhost:3000',
	})
)
