import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@solidjs/testing-library'
import './mocks/auth-client.stub'

const mockNavigate = vi.fn()
// Starts unauthenticated; individual tests override as needed.
const mockContext = vi.fn(() => ({ session: null }))

vi.mock('@tanstack/solid-router', () => ({
	useRouteContext: () => mockContext,
	useNavigate: () => mockNavigate,
	// Cancel button — not under test here
	Link: () => null,
}))

const { default: ListingForm } = await import('../src/components/ListingForm')

describe('ListingForm', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		sessionStorage.clear()
		window.history.pushState({}, '', '/listings/new')
	})

	afterEach(cleanup)

	describe('unauthenticated user', () => {
		it('shows email field', () => {
			const { getByLabelText } = render(() => <ListingForm />)
			expect(getByLabelText(/Your email/i)).toBeInTheDocument()
		})
	})

	describe('authenticated user', () => {
		it('hides email field', () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockContext.mockReturnValue({
				session: { user: { id: 'u1', name: 'Alice', email: 'alice@example.com' } },
			} as any)

			const { queryByLabelText } = render(() => <ListingForm />)
			expect(queryByLabelText(/Your email/i)).not.toBeInTheDocument()
		})
	})

	describe('auto-submit after magic-link (email link / callbackURL path)', () => {
		function pendingListing() {
			return {
				type: 'avocado',
				harvestWindow: 'July–September',
				address: '400 School St',
				city: 'Napa',
				state: 'CA',
				zip: '',
				notes: null,
			}
		}

		it('submits stored listing on mount when listing_complete=true and user is authenticated', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockContext.mockReturnValue({ session: { user: { id: 'u1' } } } as any)
			sessionStorage.setItem('pendingListing', JSON.stringify(pendingListing()))
			window.history.pushState({}, '', '/listings/new?listing_complete=true')

			const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue(
				new Response(JSON.stringify({ id: 99 }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				})
			)

			render(() => <ListingForm />)

			await waitFor(() => {
				expect(mockNavigate).toHaveBeenCalledWith(
					expect.objectContaining({ to: '/listings/$id', params: { id: '99' } })
				)
			})

			expect(mockFetch).toHaveBeenCalledWith(
				'/api/listings',
				expect.objectContaining({ method: 'POST' })
			)
			// Clears the pending entry
			expect(sessionStorage.getItem('pendingListing')).toBeNull()
		})

		it('does not auto-submit when listing_complete param is absent', async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockContext.mockReturnValue({ session: { user: { id: 'u1' } } } as any)
			sessionStorage.setItem('pendingListing', JSON.stringify(pendingListing()))
			// URL has no listing_complete param

			vi.useFakeTimers()
			try {
				const mockFetch = vi
					.spyOn(global, 'fetch')
					.mockResolvedValue(new Response('{}', { status: 200 }))

				render(() => <ListingForm />)

				await vi.runAllTimersAsync()
				expect(mockFetch).not.toHaveBeenCalled()
			} finally {
				vi.useRealTimers()
			}
		})
	})
})
