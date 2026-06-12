import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library'
import type { AddressSuggestion } from '../src/lib/address-suggestions'

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		addBreadcrumb: vi.fn(),
		startSpan: vi.fn((_, fn: () => unknown) => fn()),
		captureException: vi.fn(),
		captureMessage: vi.fn(),
	},
}))

vi.mock('../src/lib/env', () => ({
	clientEnv: {
		sentryDsn: undefined,
		sentryEnabled: false,
		sentryEnvironment: 'test',
		sentryRelease: undefined,
		sentrySampleRate: 0,
		sentryTracesSampleRate: 0,
		mode: 'test',
	},
}))

vi.mock('../src/lib/address-suggestions', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../src/lib/address-suggestions')>()
	return { ...actual, fetchAddressSuggestions: vi.fn() }
})

const { fetchAddressSuggestions, SuggestionsUnavailableError } =
	await import('../src/lib/address-suggestions')
const { default: AddressAutosuggest, SUGGEST_DEBOUNCE_MS } =
	await import('../src/components/AddressAutosuggest')

const mockFetchSuggestions = vi.mocked(fetchAddressSuggestions)

const PARIS: AddressSuggestion = {
	label: '12 Rue de la Paix, Paris, Île-de-France, 75002, France',
	address: '12 Rue de la Paix',
	city: 'Paris',
	state: 'Île-de-France',
	postcode: '75002',
	countryCode: 'FR',
	lat: 48.8693,
	lng: 2.3312,
}

const NAPA: AddressSuggestion = {
	label: '400 School Street, Napa, California, 94559, United States',
	address: '400 School Street',
	city: 'Napa',
	state: 'California',
	postcode: '94559',
	countryCode: 'US',
	lat: 38.2975,
	lng: -122.2869,
}

function renderAutosuggest(
	props: {
		onSelect?: (s: AddressSuggestion | null) => void
		defaultSelection?: AddressSuggestion
	} = {}
) {
	const onSelect = props.onSelect ?? vi.fn()
	const utils = render(() => (
		<AddressAutosuggest
			onSelect={onSelect}
			defaultSelection={props.defaultSelection}
		/>
	))
	const input = utils.getByLabelText('Address', {
		exact: true,
		selector: 'input',
	}) as HTMLInputElement
	return { ...utils, input, onSelect }
}

async function typeAndSettle(input: HTMLInputElement, value: string) {
	fireEvent.input(input, { target: { value } })
	await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS)
}

beforeEach(() => {
	vi.useFakeTimers()
	mockFetchSuggestions.mockReset()
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
})

describe('AddressAutosuggest — fetching', () => {
	it('fetches after the debounce and shows suggestions as options', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS, NAPA])
		const { input, getAllByRole } = renderAutosuggest()

		await typeAndSettle(input, 'rue de la paix')

		expect(mockFetchSuggestions).toHaveBeenCalledTimes(1)
		expect(mockFetchSuggestions.mock.calls[0][0]).toBe('rue de la paix')
		const options = getAllByRole('option')
		expect(options).toHaveLength(2)
		expect(options[0]).toHaveTextContent('12 Rue de la Paix')
	})

	it('does not fetch for queries shorter than 3 characters', async () => {
		const { input } = renderAutosuggest()

		fireEvent.input(input, { target: { value: 'pa' } })
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 4)

		expect(mockFetchSuggestions).not.toHaveBeenCalled()
	})

	it('collapses rapid keystrokes into a single request', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS])
		const { input } = renderAutosuggest()

		fireEvent.input(input, { target: { value: 'par' } })
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS / 2)
		fireEvent.input(input, { target: { value: 'paris' } })
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS)

		expect(mockFetchSuggestions).toHaveBeenCalledTimes(1)
		expect(mockFetchSuggestions.mock.calls[0][0]).toBe('paris')
	})

	it('discards stale responses that resolve after a newer query', async () => {
		let resolveFirst!: (s: AddressSuggestion[]) => void
		const first = new Promise<AddressSuggestion[]>((r) => {
			resolveFirst = r
		})
		let resolveSecond!: (s: AddressSuggestion[]) => void
		const second = new Promise<AddressSuggestion[]>((r) => {
			resolveSecond = r
		})
		mockFetchSuggestions.mockReturnValueOnce(first).mockReturnValueOnce(second)

		const { input, getAllByRole } = renderAutosuggest()

		await typeAndSettle(input, 'paris')
		await typeAndSettle(input, 'napa school')

		// The older request resolves last — its results must not clobber the
		// newer ones.
		resolveSecond([NAPA])
		await vi.advanceTimersByTimeAsync(0)
		resolveFirst([PARIS])
		await vi.advanceTimersByTimeAsync(0)

		const options = getAllByRole('option')
		expect(options).toHaveLength(1)
		expect(options[0]).toHaveTextContent('400 School Street')
	})

	it('renders a default selection without fetching', async () => {
		const { input } = renderAutosuggest({ defaultSelection: NAPA })

		expect(input.value).toBe(NAPA.label)
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 4)
		expect(mockFetchSuggestions).not.toHaveBeenCalled()
	})
})

describe('AddressAutosuggest — selection', () => {
	it('selects with ArrowDown + Enter and reports the selection', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS, NAPA])
		const { input, onSelect, queryByRole } = renderAutosuggest()

		await typeAndSettle(input, 'paris')
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		fireEvent.keyDown(input, { key: 'Enter' })

		expect(onSelect).toHaveBeenCalledWith(PARIS)
		expect(input.value).toBe(PARIS.label)
		expect(queryByRole('listbox')).not.toBeInTheDocument()
	})

	it('selects on click and reports the selection', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS, NAPA])
		const { input, onSelect, getAllByRole } = renderAutosuggest()

		await typeAndSettle(input, 'school')
		fireEvent.click(getAllByRole('option')[1])

		expect(onSelect).toHaveBeenCalledWith(NAPA)
		expect(input.value).toBe(NAPA.label)
	})

	it('clears the selection when the text is edited afterwards', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS])
		const { input, onSelect } = renderAutosuggest()

		await typeAndSettle(input, 'paris')
		fireEvent.keyDown(input, { key: 'ArrowDown' })
		fireEvent.keyDown(input, { key: 'Enter' })
		expect(onSelect).toHaveBeenLastCalledWith(PARIS)

		fireEvent.input(input, { target: { value: PARIS.label + 'x' } })

		expect(onSelect).toHaveBeenLastCalledWith(null)
	})
})

describe('AddressAutosuggest — pending work is cancelled', () => {
	it('does not open the listbox when the fetch resolves after blur', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS])
		const { input, queryByRole } = renderAutosuggest()

		fireEvent.input(input, { target: { value: 'paris' } })
		fireEvent.blur(input)
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 2)

		expect(queryByRole('listbox')).not.toBeInTheDocument()
	})

	it('does not reopen the listbox when a debounce fires after selection', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS, NAPA])
		const { input, getAllByRole, queryByRole } = renderAutosuggest()

		await typeAndSettle(input, 'paris')
		// Schedule a new debounce, then select before it fires.
		fireEvent.input(input, { target: { value: 'paris 2' } })
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS / 2)
		await typeAndSettle(input, 'paris 3')
		fireEvent.input(input, { target: { value: 'paris 4' } })
		fireEvent.click(getAllByRole('option')[0])
		await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS * 2)

		expect(input.value).toBe(PARIS.label)
		expect(queryByRole('listbox')).not.toBeInTheDocument()
	})
})

describe('AddressAutosuggest — keyboard', () => {
	it('reopens the listbox with ArrowDown after Escape', async () => {
		mockFetchSuggestions.mockResolvedValue([PARIS])
		const { input, queryByRole } = renderAutosuggest()

		await typeAndSettle(input, 'paris')
		fireEvent.keyDown(input, { key: 'Escape' })
		expect(queryByRole('listbox')).not.toBeInTheDocument()

		fireEvent.keyDown(input, { key: 'ArrowDown' })
		expect(queryByRole('listbox')).toBeInTheDocument()
	})
})

describe('AddressAutosuggest — accessibility wiring', () => {
	it('marks the input invalid and links the error via aria-describedby', () => {
		const { getByLabelText, getByText } = render(() => (
			<AddressAutosuggest
				onSelect={vi.fn()}
				errors={['Choose a suggested address, or enter it manually.']}
			/>
		))
		const input = getByLabelText('Address', {
			exact: true,
			selector: 'input',
		}) as HTMLInputElement
		const error = getByText(/Choose a suggested address/)

		expect(input).toHaveAttribute('aria-invalid', 'true')
		expect(input.getAttribute('aria-describedby')).toContain(
			error.closest('[id]')!.id
		)
	})

	it('links the hint via aria-describedby', () => {
		const { getByLabelText, getByText } = render(() => (
			<AddressAutosuggest onSelect={vi.fn()} hint="A helpful hint" />
		))
		const input = getByLabelText('Address', {
			exact: true,
			selector: 'input',
		}) as HTMLInputElement

		expect(input).not.toHaveAttribute('aria-invalid', 'true')
		expect(input.getAttribute('aria-describedby')).toContain(
			getByText('A helpful hint').id
		)
	})

	it('always points aria-controls at a real element', () => {
		const { input } = renderAutosuggest()

		const controls = input.getAttribute('aria-controls')!
		expect(document.getElementById(controls)).not.toBeNull()
	})
})

describe('AddressAutosuggest — degraded states', () => {
	it('shows an empty-state message when nothing matches', async () => {
		mockFetchSuggestions.mockResolvedValue([])
		const { input, getByText } = renderAutosuggest()

		await typeAndSettle(input, 'road to nowhere')

		await waitFor(() => {
			expect(getByText(/No matching addresses/i)).toBeInTheDocument()
		})
	})

	it('shows an unavailable message when the service fails', async () => {
		mockFetchSuggestions.mockRejectedValue(
			new SuggestionsUnavailableError('boom')
		)
		const { input, getByText } = renderAutosuggest()

		await typeAndSettle(input, 'paris')

		await waitFor(() => {
			expect(getByText(/Suggestions are unavailable/i)).toBeInTheDocument()
		})
	})
})
