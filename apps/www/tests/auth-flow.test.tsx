import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@solidjs/testing-library'
import { mockAuth } from './auth-helpers'

mockAuth()

import MagicLinkWaiting from '../src/components/MagicLinkWaiting'

describe('MagicLinkWaiting', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
	})

	it('displays the email address that received the magic link', () => {
		const { getByText } = render(() => (
			<MagicLinkWaiting
				email="gardener@example.com"
				callbackURL="/garden/mine"
				onCancel={() => {}}
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
			/>
		))

		expect(getByLabelText(/enter the token/i)).toBeInTheDocument()
		expect(getByRole('button', { name: /verify/i })).toBeInTheDocument()
	})

	it('calls onCancel when "Use different email" is clicked', async () => {
		const onCancel = vi.fn()
		const { getByRole } = render(() => (
			<MagicLinkWaiting
				email="test@example.com"
				callbackURL="/garden/mine"
				onCancel={onCancel}
			/>
		))

		const cancelButton = getByRole('button', { name: /use different email/i })
		fireEvent.click(cancelButton)

		expect(onCancel).toHaveBeenCalledTimes(1)
	})

	it('has a resend email button', () => {
		const { getByRole } = render(() => (
			<MagicLinkWaiting
				email="test@example.com"
				callbackURL="/garden/mine"
				onCancel={() => {}}
			/>
		))

		expect(getByRole('button', { name: /resend email/i })).toBeInTheDocument()
	})
})
