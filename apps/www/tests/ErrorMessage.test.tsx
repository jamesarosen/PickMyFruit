import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'

import { ErrorMessage } from '../src/components/ErrorMessage'

describe('ErrorMessage', () => {
	afterEach(() => {
		cleanup()
	})

	it('renders nothing when error is null', () => {
		const { container } = render(() => <ErrorMessage error={null} />)
		expect(container.querySelector('[role="alert"]')).toBeNull()
	})

	it('renders nothing when error is undefined', () => {
		const { container } = render(() => <ErrorMessage error={undefined} />)
		expect(container.querySelector('[role="alert"]')).toBeNull()
	})

	it('does not render defaultMessage when error is null', () => {
		const { queryByText } = render(() => (
			<ErrorMessage error={null} defaultMessage="Fallback message" />
		))
		expect(queryByText('Fallback message')).toBeNull()
	})

	it('renders the error message when the error has one', () => {
		const { getByRole } = render(() => (
			<ErrorMessage error={new Error('Something went wrong')} />
		))
		expect(getByRole('alert')).toHaveTextContent('Something went wrong')
	})

	it('renders a plain string error directly', () => {
		const { getByRole } = render(() => <ErrorMessage error="Email is required" />)
		expect(getByRole('alert')).toHaveTextContent('Email is required')
	})

	it('renders defaultMessage when error has no message', () => {
		const { getByRole } = render(() => (
			<ErrorMessage error={new Error()} defaultMessage="Custom fallback" />
		))
		expect(getByRole('alert')).toHaveTextContent('Custom fallback')
	})

	it('renders the generic fallback when error has no message and no defaultMessage', () => {
		const { getByRole } = render(() => <ErrorMessage error={new Error()} />)
		expect(getByRole('alert')).toHaveTextContent(
			"Sorry, we're having trouble right now. We've been notified."
		)
	})

	it('renders a network error message for network errors', () => {
		const networkError = Object.assign(new TypeError('Failed to fetch'), {
			name: 'TypeError',
		})
		const { getByRole } = render(() => <ErrorMessage error={networkError} />)
		expect(getByRole('alert')).toHaveTextContent(
			'Network error. Retrying may help'
		)
	})
})
