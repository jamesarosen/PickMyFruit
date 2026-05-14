import { createServerFn } from '@tanstack/solid-start'
import { NotFoundError } from '@/lib/user-error'

/**
 * Throws when `E2E_THROW_ROOT_ERROR=1` so Playwright can assert the root error boundary UI.
 * Otherwise throws {@link NotFoundError} so `/root-error` is not a public feature surface.
 */
export const triggerE2eRootErrorBoundary = createServerFn({
	method: 'GET',
}).handler(async () => {
	if (process.env.E2E_THROW_ROOT_ERROR !== '1') {
		throw new NotFoundError()
	}
	throw new Error('E2E intentional root error boundary')
})
