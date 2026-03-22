import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'
import './mocks/auth-client.stub'
import { mockSendMagicLink, mockUpdateUser } from './mocks/auth-client.stub'

// Provide a reactive route context with an authenticated user by default.
// Individual tests can override the return value when they need an
// unauthenticated context.
const mockSession = vi.fn(() => ({
	session: {
		user: { id: 'user-1', name: 'Test User', email: 'test@example.com' },
	},
}))
const mockInvalidate = vi.fn().mockResolvedValue(undefined)
vi.mock('@tanstack/solid-router', () => ({
	useRouteContext: () => mockSession,
	useRouter: () => ({ invalidate: mockInvalidate }),
}))

const mockSubmitInquiry = vi.fn()
vi.mock('@/api/inquiries', () => ({ submitInquiry: mockSubmitInquiry }))

// Loaded after mocks are set up.
const { default: InquiryForm } = await import('../src/components/InquiryForm')

const defaultProps = {
	listingId: 42,
	listingType: 'fig',
	callbackURL: '/listings/42',
}

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
			<InquiryForm {...defaultProps} />
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
		mockSendMagicLink.mockResolvedValue({
			data: undefined,
			error: new Error('Failed to send sign-in link'),
		})

		const { getByRole, getByLabelText, getByText } = render(() => (
			<InquiryForm {...defaultProps} />
		))

		fireEvent.input(getByLabelText(/Your email/), {
			target: { value: 'gardener@example.com' },
		})
		fireEvent.click(getByRole('button', { name: 'Put me in touch' }))

		await waitFor(() => {
			expect(
				getByText('Failed to send sign-in link', { exact: false })
			).toBeInTheDocument()
		})

		// Form stays visible — the user can correct their email or retry.
		expect(getByRole('button', { name: 'Put me in touch' })).toBeInTheDocument()
		// Never transitioned to the "Check your email" screen.
		expect(getByRole('button', { name: 'Put me in touch' })).not.toBeDisabled()
	})
})

describe('InquiryForm name interstitial', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSubmitInquiry.mockResolvedValue({ inquiryId: 1 })
		mockUpdateUser.mockResolvedValue({ data: {}, error: null })
	})

	afterEach(cleanup)

	// Simulate arriving back from magic-link email: session now populated,
	// inquiry_complete=true in the URL, pending inquiry in sessionStorage.
	function setupPostMagicLink(userOverrides: { name: string; email: string }) {
		mockSession.mockReturnValue({
			session: { user: { id: 'user-1', ...userOverrides } },
		})
		sessionStorage.setItem(
			'pendingInquiry',
			JSON.stringify({ listingId: 42, note: '' })
		)
		// JSDOM blocks replaceState when the URL doesn't match the test origin
		vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
		Object.defineProperty(window, 'location', {
			value: {
				...window.location,
				search: '?inquiry_complete=true',
				href: 'http://localhost/listings/42?inquiry_complete=true',
			},
			writable: true,
			configurable: true,
		})
	}

	it('shows interstitial and live preview for blank-name user', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })

		const { getByRole, getByText } = render(() => (
			<InquiryForm {...defaultProps} />
		))

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		// Preview shows email local-part as fallback
		expect(getByText(/jsmith wants your fig/)).toBeInTheDocument()

		// Name field is empty (not pre-filled with email local-part)
		const nameInput = getByRole('textbox', { name: /Your name/i })
		expect(nameInput).toHaveValue('')
	})

	it('preview updates live as user types a name', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })

		const { getByRole, getByText } = render(() => (
			<InquiryForm {...defaultProps} />
		))

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		const nameInput = getByRole('textbox', { name: /Your name/i })
		fireEvent.input(nameInput, { target: { value: 'Jane Gleaner' } })

		await waitFor(() => {
			expect(getByText(/Jane Gleaner wants your fig/)).toBeInTheDocument()
		})
	})

	it('saves name and submits when user fills in a name and clicks Send', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })

		const { getByRole } = render(() => <InquiryForm {...defaultProps} />)

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		const nameInput = getByRole('textbox', { name: /Your name/i })
		fireEvent.input(nameInput, { target: { value: 'Jane Gleaner' } })
		fireEvent.click(getByRole('button', { name: 'Update name & send inquiry' }))

		await waitFor(() => {
			expect(mockUpdateUser).toHaveBeenCalledWith({ name: 'Jane Gleaner' })
			expect(mockSubmitInquiry).toHaveBeenCalled()
		})
	})

	it('submits without calling updateUser when user skips', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })

		const { getByRole } = render(() => <InquiryForm {...defaultProps} />)

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		fireEvent.click(
			getByRole('button', { name: 'No thanks. Send the email as-is' })
		)

		await waitFor(() => {
			expect(mockSubmitInquiry).toHaveBeenCalled()
		})
		expect(mockUpdateUser).not.toHaveBeenCalled()
	})

	it('submits without saving name when name field is left empty', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })

		const { getByRole } = render(() => <InquiryForm {...defaultProps} />)

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		// Click Send without typing anything
		fireEvent.click(getByRole('button', { name: 'Update name & send inquiry' }))

		await waitFor(() => {
			expect(mockSubmitInquiry).toHaveBeenCalled()
		})
		expect(mockUpdateUser).not.toHaveBeenCalled()
	})

	it('submits inquiry even when name save fails', async () => {
		setupPostMagicLink({ name: '', email: 'jsmith@example.com' })
		mockUpdateUser.mockResolvedValue({
			data: null,
			error: new Error('Network error'),
		})

		const { getByRole } = render(() => <InquiryForm {...defaultProps} />)

		await waitFor(() => {
			expect(
				getByRole('heading', { name: 'Before we send your inquiry…' })
			).toBeInTheDocument()
		})

		const nameInput = getByRole('textbox', { name: /Your name/i })
		fireEvent.input(nameInput, { target: { value: 'Jane Gleaner' } })
		fireEvent.click(getByRole('button', { name: 'Update name & send inquiry' }))

		// Inquiry still submits despite the name save failing
		await waitFor(() => {
			expect(mockSubmitInquiry).toHaveBeenCalled()
		})
	})

	it('skips interstitial and submits directly for user who already has a name', async () => {
		setupPostMagicLink({ name: 'Existing User', email: 'existing@example.com' })

		const { queryByRole } = render(() => <InquiryForm {...defaultProps} />)

		await waitFor(() => {
			expect(mockSubmitInquiry).toHaveBeenCalled()
		})
		expect(
			queryByRole('heading', { name: 'Before we send your inquiry…' })
		).not.toBeInTheDocument()
		expect(mockUpdateUser).not.toHaveBeenCalled()
	})
})
