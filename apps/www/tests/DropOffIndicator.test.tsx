import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@solidjs/testing-library'
import DropOffIndicator from '../src/components/DropOffIndicator'

describe('DropOffIndicator', () => {
	afterEach(cleanup)

	it('renders the accepting state with title, label, and icon alt', () => {
		const { getByRole, getByText } = render(() => (
			<DropOffIndicator acceptsDropOffs={true} />
		))
		const el = getByRole('img', { name: 'Accepts drop-offs' })
		expect(el).toHaveAttribute('title', 'Accepts drop-offs')
		expect(el).toHaveClass('drop-off-indicator--accepts')
		// Label text is always in the DOM; the container query reveals it when wide.
		expect(getByText('Accepts drop-offs')).toBeInTheDocument()
		// The icon carries the label as alt for the icon-only (narrow) layout.
		expect(el.querySelector('svg')).toHaveAttribute('alt', 'Accepts drop-offs')
	})

	it('renders the declining state', () => {
		const { getByRole } = render(() => (
			<DropOffIndicator acceptsDropOffs={false} />
		))
		const el = getByRole('img', { name: 'Does not accept drop-offs' })
		expect(el).toHaveAttribute('title', 'Does not accept drop-offs')
		expect(el).toHaveClass('drop-off-indicator--declines')
		expect(el.querySelector('svg')).toHaveAttribute(
			'alt',
			'Does not accept drop-offs'
		)
	})

	it('applies a consumer-provided class for slot sizing', () => {
		const { getByRole } = render(() => (
			<DropOffIndicator acceptsDropOffs={true} class="listing-card-dropoff" />
		))
		expect(getByRole('img')).toHaveClass('listing-card-dropoff')
	})
})
