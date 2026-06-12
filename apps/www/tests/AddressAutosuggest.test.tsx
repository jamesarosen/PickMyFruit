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
	return {
		...actual,
		fetchAddressSuggestions: vi.fn(),
		fetchReverseGeocodedAddress: vi.fn(),
	}
})

vi.mock('../src/lib/geolocation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/lib/geolocation')>()
	return { ...actual, requestCurrentLocation: vi.fn() }
})

const {
	fetchAddressSuggestions,
	fetchReverseGeocodedAddress,
	SuggestionsUnavailableError,
} = await import('../src/lib/address-suggestions')
const { NAPA_CITY_HALL, requestCurrentLocation } =
	await import('../src/lib/geolocation')
const { default: AddressAutosuggest, SUGGEST_DEBOUNCE_MS } =
	await import('../src/components/AddressAutosuggest')

const mockFetchSuggestions = vi.mocked(fetchAddressSuggestions)
const mockFetchReverse = vi.mocked(fetchReverseGeocodedAddress)
const mockRequestLocation = vi.mocked(requestCurrentLocation)

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
		allowPrepopulate?: boolean
		onInteract?: () => void
	} = {}
) {
	const onSelect = props.onSelect ?? vi.fn()
	const utils = render(() => (
		<AddressAutosuggest
			onSelect={onSelect}
			defaultSelection={props.defaultSelection}
			allowPrepopulate={props.allowPrepopulate}
			onInteract={props.onInteract}
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
	mockFetchReverse.mockReset()
	mockFetchReverse.mockResolvedValue(null)
	mockRequestLocation.mockReset()
	// Most tests don't care about geolocation — behave as if unavailable.
	mockRequestLocation.mockResolvedValue(null)
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

const GRANTED_POSITION = { lat: 38.291859, lng: -122.458036 }

const REVERSE_SUGGESTION: AddressSuggestion = {
	label: '1600 Reverse Road, Sonoma, California, 95476, United States',
	address: '1600 Reverse Road',
	city: 'Sonoma',
	state: 'California',
	postcode: '95476',
	countryCode: 'US',
	lat: GRANTED_POSITION.lat,
	lng: GRANTED_POSITION.lng,
}

describe('AddressAutosuggest — location bias', () => {
	it('passes the granted position as the suggest bias', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input } = renderAutosuggest()
		// Let the position promise resolve before typing.
		await vi.advanceTimersByTimeAsync(0)

		await typeAndSettle(input, 'school')

		expect(mockFetchSuggestions).toHaveBeenCalledWith(
			'school',
			expect.objectContaining({ bias: GRANTED_POSITION })
		)
	})

	it('falls back to the Napa City Hall bias when the position is unavailable', async () => {
		mockRequestLocation.mockResolvedValue(null)
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input } = renderAutosuggest()
		await vi.advanceTimersByTimeAsync(0)

		await typeAndSettle(input, 'school')

		expect(mockFetchSuggestions).toHaveBeenCalledWith(
			'school',
			expect.objectContaining({ bias: NAPA_CITY_HALL })
		)
	})

	it('uses the fallback bias while the position request is still pending', async () => {
		// A user can type before answering the permission prompt.
		mockRequestLocation.mockReturnValue(new Promise(() => {}))
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input } = renderAutosuggest()

		await typeAndSettle(input, 'school')

		expect(mockFetchSuggestions).toHaveBeenCalledWith(
			'school',
			expect.objectContaining({ bias: NAPA_CITY_HALL })
		)
	})
})

describe('AddressAutosuggest — prepopulation from the granted position', () => {
	it('prepopulates the empty field from the reverse geocode and reports the selection', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		const { input, onSelect } = renderAutosuggest()

		await vi.advanceTimersByTimeAsync(0)

		expect(mockFetchReverse).toHaveBeenCalledWith(
			GRANTED_POSITION,
			expect.anything()
		)
		expect(input.value).toBe(REVERSE_SUGGESTION.label)
		expect(onSelect).toHaveBeenCalledWith(REVERSE_SUGGESTION)
	})

	it('skips the reverse geocode when a pre-filled selection exists', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		const { input } = renderAutosuggest({ defaultSelection: NAPA })

		await vi.advanceTimersByTimeAsync(0)

		expect(mockFetchReverse).not.toHaveBeenCalled()
		expect(input.value).toBe(NAPA.label)
	})

	it('skips the reverse geocode when the position is unavailable', async () => {
		mockRequestLocation.mockResolvedValue(null)
		renderAutosuggest()

		await vi.advanceTimersByTimeAsync(0)

		expect(mockFetchReverse).not.toHaveBeenCalled()
	})

	it('does not clobber text typed while the reverse geocode is in flight', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		let resolveReverse!: (s: AddressSuggestion | null) => void
		mockFetchReverse.mockReturnValue(
			new Promise((r) => {
				resolveReverse = r
			})
		)
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input, onSelect } = renderAutosuggest()
		// Position resolves; the reverse geocode is now in flight.
		await vi.advanceTimersByTimeAsync(0)

		fireEvent.input(input, { target: { value: 'my own query' } })
		resolveReverse(REVERSE_SUGGESTION)
		await vi.advanceTimersByTimeAsync(0)

		expect(input.value).toBe('my own query')
		expect(onSelect).not.toHaveBeenCalledWith(REVERSE_SUGGESTION)
	})

	it('does not clobber text typed before the position resolves', async () => {
		let resolvePosition!: (p: { lat: number; lng: number } | null) => void
		mockRequestLocation.mockReturnValue(
			new Promise((r) => {
				resolvePosition = r
			})
		)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input, onSelect } = renderAutosuggest()

		fireEvent.input(input, { target: { value: 'my own query' } })
		resolvePosition(GRANTED_POSITION)
		await vi.advanceTimersByTimeAsync(0)

		expect(input.value).toBe('my own query')
		expect(onSelect).not.toHaveBeenCalledWith(REVERSE_SUGGESTION)
	})

	it('announces the prepopulation through the status live region', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		const { getByRole } = renderAutosuggest()

		await vi.advanceTimersByTimeAsync(0)

		expect(getByRole('status')).toHaveTextContent(
			/filled in from your current location/i
		)
	})

	it('clears the prepopulation notice once the user edits the field', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input, getByRole } = renderAutosuggest()
		await vi.advanceTimersByTimeAsync(0)

		fireEvent.input(input, { target: { value: 'something else' } })

		expect(getByRole('status')).not.toHaveTextContent(/current location/i)
	})

	it('skips prepopulation when the input is focused before the position resolves', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		const { input, onSelect } = renderAutosuggest()

		// The user clicked into the field intending to type — it's theirs now,
		// even though they haven't typed yet.
		fireEvent.focus(input)
		await vi.advanceTimersByTimeAsync(0)

		expect(input.value).toBe('')
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('skips prepopulation when the parent disallows it', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		const { input, onSelect } = renderAutosuggest({ allowPrepopulate: false })

		await vi.advanceTimersByTimeAsync(0)

		expect(mockFetchReverse).not.toHaveBeenCalled()
		expect(input.value).toBe('')
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('reports the first user interaction via onInteract', async () => {
		const onInteract = vi.fn()
		mockFetchSuggestions.mockResolvedValue([NAPA])
		const { input } = renderAutosuggest({ onInteract })

		await typeAndSettle(input, 'school')
		await typeAndSettle(input, 'school street')

		expect(onInteract).toHaveBeenCalledTimes(1)
	})

	it('does not report the prepopulation itself as an interaction', async () => {
		const onInteract = vi.fn()
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockResolvedValue(REVERSE_SUGGESTION)
		renderAutosuggest({ onInteract })

		await vi.advanceTimersByTimeAsync(0)

		expect(onInteract).not.toHaveBeenCalled()
	})

	it('stays silent when the reverse geocode fails', async () => {
		mockRequestLocation.mockResolvedValue(GRANTED_POSITION)
		mockFetchReverse.mockRejectedValue(new SuggestionsUnavailableError('boom'))
		const { input, queryByText } = renderAutosuggest()

		await vi.advanceTimersByTimeAsync(0)

		expect(input.value).toBe('')
		expect(queryByText(/unavailable/i)).not.toBeInTheDocument()
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
