import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'
import { mockVerify, mockSendMagicLink } from './mocks/auth-client.stub'

import MagicLinkWaiting from '../src/components/MagicLinkWaiting'

describe('MagicLinkWaiting', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
	})

	describe('rendering', () => {
		it('displays the email address that received the magic link', () => {
			const { getByText } = render(() => (
				<MagicLinkWaiting
					email="gardener@example.com"
					callbackURL="/garden/mine"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			expect(getByText('gardener@example.com')).toBeInTheDocument()
		})

		it('renders token input and verify button', () => {
			const { getByLabelText, getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/garden/mine"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			expect(getByLabelText(/enter the token/i)).toBeInTheDocument()
			expect(getByRole('button', { name: /verify/i })).toBeInTheDocument()
		})

		it('has a resend email button', () => {
			const { getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/garden/mine"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			expect(getByRole('button', { name: /resend email/i })).toBeInTheDocument()
		})
	})

	describe('interactions', () => {
		it('calls onCancel when "Use different email" is clicked', async () => {
			const onCancel = vi.fn()
			const { getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/garden/mine"
					onCancel={onCancel}
					onVerified={() => {}}
				/>
			))

			const cancelButton = getByRole('button', { name: /use different email/i })
			fireEvent.click(cancelButton)

			expect(onCancel).toHaveBeenCalledTimes(1)
		})

		it('calls authClient.signIn.magicLink when resend is clicked', async () => {
			mockSendMagicLink.mockResolvedValue({})

			const { getByRole } = render(() => (
				<MagicLinkWaiting
					email="gardener@example.com"
					callbackURL="/garden/mine"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			fireEvent.click(getByRole('button', { name: /resend email/i }))

			await waitFor(() => {
				expect(mockSendMagicLink).toHaveBeenCalledWith({
					email: 'gardener@example.com',
					callbackURL: '/garden/mine',
				})
			})
		})
	})

	describe('token verification', () => {
		it('calls onVerified on successful token verification', async () => {
			mockVerify.mockResolvedValue({ data: { user: {} } })
			const onVerified = vi.fn()

			const { getByLabelText, getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/dashboard"
					onCancel={() => {}}
					onVerified={onVerified}
				/>
			))

			fireEvent.input(getByLabelText(/enter the token/i), {
				target: { value: 'abc123' },
			})
			fireEvent.click(getByRole('button', { name: /verify/i }))

			await waitFor(() => {
				expect(mockVerify).toHaveBeenCalledWith({
					query: { token: 'abc123' },
					fetchOptions: { redirect: 'manual' },
				})
				expect(onVerified).toHaveBeenCalled()
			})
		})

		it('displays error message on verification failure', async () => {
			mockVerify.mockResolvedValue({ error: { message: 'Token expired' } })

			const { getByLabelText, getByRole, getByText } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/dashboard"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			fireEvent.input(getByLabelText(/enter the token/i), {
				target: { value: 'bad-token' },
			})
			fireEvent.click(getByRole('button', { name: /verify/i }))

			await waitFor(() => {
				expect(getByText('Token expired')).toBeInTheDocument()
			})
		})

		it('does not submit empty token', async () => {
			const { getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/dashboard"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			fireEvent.click(getByRole('button', { name: /verify/i }))

			expect(mockVerify).not.toHaveBeenCalled()
		})

		it('shows verifying state during submission', async () => {
			let resolveVerify: (value: unknown) => void
			mockVerify.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveVerify = resolve
					})
			)

			const { getByLabelText, getByRole } = render(() => (
				<MagicLinkWaiting
					email="test@example.com"
					callbackURL="/dashboard"
					onCancel={() => {}}
					onVerified={() => {}}
				/>
			))

			fireEvent.input(getByLabelText(/enter the token/i), {
				target: { value: 'abc123' },
			})
			fireEvent.click(getByRole('button', { name: /verify/i }))

			await waitFor(() => {
				expect(getByRole('button', { name: /verifying/i })).toBeDisabled()
			})

			resolveVerify!({ data: {} })
		})
	})
})
