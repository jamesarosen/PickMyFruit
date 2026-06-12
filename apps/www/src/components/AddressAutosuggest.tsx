import { createSignal, createUniqueId, For, onCleanup, Show } from 'solid-js'
import {
	fetchAddressSuggestions,
	SuggestionsUnavailableError,
	type AddressSuggestion,
} from '@/lib/address-suggestions'
import { Sentry } from '@/lib/sentry'
import '@/components/AddressAutosuggest.css'

/** Quiet period after the last keystroke before suggestions are fetched. */
export const SUGGEST_DEBOUNCE_MS = 300

/** Queries shorter than this are too ambiguous to be worth a request. */
const MIN_QUERY_LENGTH = 3

type SuggestStatus = 'idle' | 'loading' | 'empty' | 'error'

export interface AddressAutosuggestProps {
	/** Pre-selected suggestion (e.g. rebuilt from the user's last listing). */
	defaultSelection?: AddressSuggestion | null
	disabled?: boolean
	errors?: string[]
	hint?: string
	/** Fires with the chosen suggestion, or null when the text is edited. */
	onSelect: (selection: AddressSuggestion | null) => void
}

/**
 * A single-field international address input following the WAI-ARIA combobox
 * pattern. Typing fetches Photon-backed suggestions; choosing one supplies
 * the structured address and its coordinates via `onSelect`. Degrades to a
 * status message (never an error wall) when the suggestion service fails —
 * the manual-entry fallback rendered by the parent stays available.
 */
export default function AddressAutosuggest(props: AddressAutosuggestProps) {
	const inputId = createUniqueId()
	const listboxId = createUniqueId()
	const optionId = (index: number) => `${listboxId}-option-${index}`

	const [query, setQuery] = createSignal(props.defaultSelection?.label ?? '')
	const [suggestions, setSuggestions] = createSignal<AddressSuggestion[]>([])
	const [open, setOpen] = createSignal(false)
	const [activeIndex, setActiveIndex] = createSignal(-1)
	const [status, setStatus] = createSignal<SuggestStatus>('idle')

	let debounceTimer: ReturnType<typeof setTimeout> | undefined
	let inFlight: AbortController | undefined
	// Monotonic request marker — a response only applies if it is still the
	// newest request. Aborting helps, but a slow response can still resolve
	// after a newer one; this guard makes ordering explicit.
	let requestSeq = 0

	onCleanup(() => {
		clearTimeout(debounceTimer)
		inFlight?.abort()
	})

	function closeListbox() {
		setOpen(false)
		setActiveIndex(-1)
	}

	async function runFetch(value: string) {
		const seq = ++requestSeq
		inFlight?.abort()
		const controller = new AbortController()
		inFlight = controller

		setStatus('loading')
		try {
			const results = await fetchAddressSuggestions(value, {
				signal: controller.signal,
			})
			if (seq !== requestSeq) return
			setSuggestions(results)
			setActiveIndex(-1)
			setOpen(results.length > 0)
			setStatus(results.length === 0 ? 'empty' : 'idle')
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return
			if (seq !== requestSeq) return
			if (!(err instanceof SuggestionsUnavailableError)) {
				Sentry.captureException(err)
			}
			setSuggestions([])
			closeListbox()
			setStatus('error')
		}
	}

	function handleInput(event: InputEvent) {
		const value = (event.currentTarget as HTMLInputElement).value
		setQuery(value)
		// Any edit invalidates a previous selection — the text no longer
		// matches the suggestion's coordinates.
		props.onSelect(null)

		clearTimeout(debounceTimer)
		if (value.trim().length < MIN_QUERY_LENGTH) {
			requestSeq++
			inFlight?.abort()
			setSuggestions([])
			closeListbox()
			setStatus('idle')
			return
		}
		debounceTimer = setTimeout(() => void runFetch(value), SUGGEST_DEBOUNCE_MS)
	}

	function select(suggestion: AddressSuggestion) {
		setQuery(suggestion.label)
		setSuggestions([])
		closeListbox()
		setStatus('idle')
		props.onSelect(suggestion)
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!open()) return
		const count = suggestions().length
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault()
				setActiveIndex((i) => (i + 1) % count)
				break
			case 'ArrowUp':
				event.preventDefault()
				setActiveIndex((i) => (i <= 0 ? count - 1 : i - 1))
				break
			case 'Enter': {
				const active = suggestions()[activeIndex()]
				if (active) {
					event.preventDefault()
					select(active)
				}
				break
			}
			case 'Escape':
				event.preventDefault()
				closeListbox()
				break
		}
	}

	return (
		<div class="form-field address-autosuggest">
			{/* The asterisk lives outside the label so the field's accessible
			    name is exactly "Address". */}
			<span class="form-field__label address-autosuggest__label-row">
				<label for={inputId}>Address</label>
				&nbsp;
				<span class="form-field__required" aria-hidden="true">
					*
				</span>
			</span>
			<input
				aria-activedescendant={
					activeIndex() >= 0 ? optionId(activeIndex()) : undefined
				}
				aria-autocomplete="list"
				aria-controls={listboxId}
				aria-expanded={open()}
				autocomplete="off"
				class="form-field__control"
				disabled={props.disabled}
				id={inputId}
				onBlur={closeListbox}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				placeholder="Start typing your address…"
				required
				role="combobox"
				type="text"
				value={query()}
			/>
			<Show when={open()}>
				<ul class="address-autosuggest__listbox" id={listboxId} role="listbox">
					<For each={suggestions()}>
						{(suggestion, index) => (
							<li
								aria-selected={index() === activeIndex()}
								class="address-autosuggest__option"
								id={optionId(index())}
								// preventDefault keeps focus in the input so the blur
								// handler doesn't close the listbox before click fires.
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => select(suggestion)}
								role="option"
							>
								{suggestion.label}
							</li>
						)}
					</For>
				</ul>
			</Show>
			<Show when={status() === 'empty'}>
				<p class="address-autosuggest__status" role="status">
					No matching addresses. Check the spelling, or enter the address manually
					below.
				</p>
			</Show>
			<Show when={status() === 'error'}>
				<p class="address-autosuggest__status" role="status">
					Suggestions are unavailable right now. Enter the address manually below.
				</p>
			</Show>
			<Show when={props.hint}>
				<div class="form-field__hint">{props.hint}</div>
			</Show>
			<Show when={(props.errors?.length ?? 0) > 0}>
				<div class="form-field__errors">
					<For each={props.errors}>
						{(error) => <div class="form-field__error">{error}</div>}
					</For>
				</div>
			</Show>
		</div>
	)
}
