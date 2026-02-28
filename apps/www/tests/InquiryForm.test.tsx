import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'
import './mocks/auth-client.stub'
import { mockSendMagicLink } from './mocks/auth-client.stub'

// Provide a reactive route context with an authenticated user by default.
// Individual tests can override the return value when they need an
// unauthenticated context.
const mockSession = vi.fn(() => ({ session: { user: { id: 'user-1' } } }))
vi.mock('@tanstack/solid-router', () => ({
	useRouteContext: () => mockSession,
}))

const mockSubmitInquiry = vi.fn()
vi.mock('@/api/inquiries', () => ({ submitInquiry: mockSubmitInquiry }))

// Loaded after mocks are set up.
const { default: InquiryForm } = await import('../src/components/InquiryForm')

describe('InquiryForm error handling', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(cleanup)

	it('shows error and keeps form interactive when submission fails', async () => {
		mockSubmitInquiry.mockRejectedValue(
			new Error("We couldn't send the notification email. Please try again.")
		)

		const { getByRole, getByText } = render(() => (
			<InquiryForm listingId={42} callbackURL="/listings/42" />
		))

		fireEvent.click(getByRole('button', { name: 'Put me in touch' }))

		await waitFor(() => {
			expect(
				getByText("We couldn't send the notification email. Please try again.")
			).toBeInTheDocument()
		})

		// Form stays visible so the user can retry.
		expect(getByRole('button', { name: 'Put me in touch' })).toBeInTheDocument()
	})

	it('shows error when magic-link send fails for unauthenticated user', async () => {
		// Unauthenticated context.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		mockSession.mockReturnValue({ session: null } as any)
		mockSendMagicLink.mockRejectedValue(
			new Error('Magic link email failed: validation_error — API key is invalid')
		)

		const { getByRole, getByLabelText, getByText } = render(() => (
			<InquiryForm listingId={42} callbackURL="/listings/42" />
		))

		fireEvent.input(getByLabelText('Your email'), {
			target: { value: 'gardener@example.com' },
		})
		fireEvent.click(getByRole('button', { name: 'Put me in touch' }))

		await waitFor(() => {
			expect(
				getByText('Magic link email failed: validation_error — API key is invalid')
			).toBeInTheDocument()
		})

		// Form stays visible — the user can correct their email or retry.
		expect(getByRole('button', { name: 'Put me in touch' })).toBeInTheDocument()
		// Never transitioned to the "Check your email" screen.
		expect(getByRole('button', { name: 'Put me in touch' })).not.toBeDisabled()
	})
})
