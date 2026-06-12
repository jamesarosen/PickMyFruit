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
	const statusId = `${inputId}-status`
	const hintId = `${inputId}-hint`
	const errorsId = `${inputId}-errors`
	const optionId = (index: number) => `${listboxId}-option-${index}`

	const [query, setQuery] = createSignal(props.defaultSelection?.label ?? '')
	const [suggestions, setSuggestions] = createSignal<AddressSuggestion[]>([])
	const [open, setOpen] = createSignal(false)
	const [activeIndex, setActiveIndex] = createSignal(-1)
	const [status, setStatus] = createSignal<SuggestStatus>('idle')

	const hasErrors = () => (props.errors?.length ?? 0) > 0

	const describedBy = () => {
		const ids = [statusId]
		if (props.hint) ids.push(hintId)
		if (hasErrors()) ids.push(errorsId)
		return ids.join(' ')
	}

	const statusMessage = () => {
		switch (status()) {
			case 'empty':
				return 'No matching addresses. Check the spelling, or enter the address manually below.'
			case 'error':
				return 'Suggestions are unavailable right now. Enter the address manually below.'
			default:
				return ''
		}
	}

	let debounceTimer: ReturnType<typeof setTimeout> | undefined
	let inFlight: AbortController | undefined
	// Monotonic request marker — a response only applies if it is still the
	// newest request. Aborting helps, but a slow response can still resolve
	// after a newer one; this guard makes ordering explicit.
	let requestSeq = 0

	onCleanup(cancelPending)

	// Invalidates any scheduled debounce and in-flight request so a late
	// response cannot reopen the listbox after blur or selection.
	function cancelPending() {
		clearTimeout(debounceTimer)
		requestSeq++
		inFlight?.abort()
	}

	function closeListbox() {
		setOpen(false)
		setActiveIndex(-1)
	}

	function handleBlur() {
		cancelPending()
		closeListbox()
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

		cancelPending()
		if (value.trim().length < MIN_QUERY_LENGTH) {
			setSuggestions([])
			closeListbox()
			setStatus('idle')
			return
		}
		debounceTimer = setTimeout(() => void runFetch(value), SUGGEST_DEBOUNCE_MS)
	}

	function select(suggestion: AddressSuggestion) {
		cancelPending()
		setQuery(suggestion.label)
		setSuggestions([])
		closeListbox()
		setStatus('idle')
		props.onSelect(suggestion)
	}

	function handleKeyDown(event: KeyboardEvent) {
		// ArrowDown reopens a listbox dismissed with Escape (APG pattern).
		if (!open()) {
			if (event.key === 'ArrowDown' && suggestions().length > 0) {
				event.preventDefault()
				setOpen(true)
				setActiveIndex(0)
			}
			return
		}
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
				aria-describedby={describedBy()}
				aria-expanded={open()}
				aria-invalid={hasErrors() ? 'true' : undefined}
				autocomplete="off"
				class="form-field__control"
				disabled={props.disabled}
				id={inputId}
				onBlur={handleBlur}
				onInput={handleInput}
				onKeyDown={handleKeyDown}
				placeholder="Start typing your address…"
				required
				role="combobox"
				type="text"
				value={query()}
			/>
			{/* Always mounted so aria-controls resolves while closed. */}
			<ul
				class="address-autosuggest__listbox"
				hidden={!open()}
				id={listboxId}
				role="listbox"
			>
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
			{/* Always mounted: a live region must exist before its content
			    changes for screen readers to announce it. */}
			<p class="address-autosuggest__status" id={statusId} role="status">
				{statusMessage()}
			</p>
			<Show when={props.hint}>
				<div class="form-field__hint" id={hintId}>
					{props.hint}
				</div>
			</Show>
			<Show when={hasErrors()}>
				<div class="form-field__errors" id={errorsId}>
					<For each={props.errors}>
						{(error) => <div class="form-field__error">{error}</div>}
					</For>
				</div>
			</Show>
		</div>
	)
}
