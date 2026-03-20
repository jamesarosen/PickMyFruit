import { createSignal, onMount, Show } from 'solid-js'
import { latLngToCell, cellToLatLng, isValidCell } from 'h3-js'
import { Select, SelectItem, SelectItemLabel } from '@/components/Select'
import { geocodeAddress } from '@/lib/geocode'
import { Sentry } from '@/lib/sentry'
import SubscriptionCoverageMap from '@/components/SubscriptionCoverageMap'
import ProduceTypeMultiSelect from '@/components/ProduceTypeMultiSelect'
import { RING_SIZE_LABELS } from '@/lib/subscription-labels'
import './SubscriptionForm.css'
import { useRouteContext } from '@tanstack/solid-router'
import { Input } from './FormField'

interface SubscriptionFormValues {
	locationName: string
	throttlePeriod: 'hourly' | 'daily' | 'weekly'
	centerH3: string
	resolution: number
	ringSize: number
	produceTypes?: string[]
}

interface SubscriptionFormProps {
	initialValues?: Partial<SubscriptionFormValues>
	onSubmit: (data: SubscriptionFormValues) => Promise<void>
}

const THROTTLE_OPTIONS = [
	{ value: 'hourly' as const, label: 'Hourly' },
	{ value: 'daily' as const, label: 'Daily' },
	{ value: 'weekly' as const, label: 'Weekly' },
]

const DEFAULT_RESOLUTION = 7

/** Form for creating or editing a notification subscription. */
export default function SubscriptionForm(props: SubscriptionFormProps) {
	const context = useRouteContext({ from: '__root__' })
	const user = () => context().session?.user
	// Disabled during SSR; enabled once JS has hydrated so Playwright waits for
	// event handlers to be attached before interacting with the button.
	const [hydrated, setHydrated] = createSignal(false)
	onMount(() => setHydrated(true))

	let addressInputRef!: HTMLInputElement
	let geocodeController: AbortController | null = null

	const defaultAddress =
		props.initialValues?.locationName ||
		(props.initialValues?.centerH3 ? '' : 'Napa, CA 94558')
	const [addressQuery, setAddressQuery] = createSignal(defaultAddress)
	const [geocodeResult, setGeocodeResult] = createSignal<{
		lat: number
		lng: number
		displayName: string
	} | null>(null)
	const [geocoding, setGeocoding] = createSignal(false)
	const [geocodeError, setGeocodeError] = createSignal<string | null>(null)

	const [throttlePeriod, setThrottlePeriod] = createSignal<
		(typeof THROTTLE_OPTIONS)[number] | null
	>(
		THROTTLE_OPTIONS.find(
			(o) => o.value === props.initialValues?.throttlePeriod
		) ?? null
	)
	const resolution = props.initialValues?.resolution ?? DEFAULT_RESOLUTION
	const [ringSize, setRingSize] = createSignal<number>(
		props.initialValues?.ringSize ?? 2
	)

	const [selectedProduceTypes, setSelectedProduceTypes] = createSignal<string[]>(
		props.initialValues?.produceTypes ?? []
	)

	const [submitting, setSubmitting] = createSignal(false)
	const [submitError, setSubmitError] = createSignal<string | null>(null)

	async function handleSearch() {
		// Read directly from DOM to handle Vite HMR resets of the signal value
		const query = (addressInputRef?.value ?? addressQuery()).trim()
		if (!query) {
			return
		}
		// Abort any in-flight request before starting a new one
		geocodeController?.abort()
		geocodeController = new AbortController()
		const { signal } = geocodeController
		setGeocoding(true)
		setGeocodeError(null)
		try {
			const result = await geocodeAddress(query, signal)
			if (result) {
				setGeocodeResult(result)
			} else {
				setGeocodeError('Address not found. Try a different search.')
				setGeocodeResult(null)
			}
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				// Superseded by a newer search — ignore silently
				return
			}
			Sentry.captureException(err)
			setGeocodeError('Search failed. Please try again.')
			setGeocodeResult(null)
		} finally {
			setGeocoding(false)
		}
	}

	const centerH3 = () => {
		const res = resolution
		const result = geocodeResult()
		if (result) {
			return latLngToCell(result.lat, result.lng, res)
		}
		// Re-project the stored cell at the currently-selected resolution so the
		// map and submission stay consistent when the user changes coverage size
		// without re-geocoding.
		const stored = props.initialValues?.centerH3
		if (stored && isValidCell(stored)) {
			const [lat, lng] = cellToLatLng(stored)
			return latLngToCell(lat, lng, res)
		}
		return null
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault()
		const h3 = centerH3()
		const period = throttlePeriod()
		if (!h3) {
			setSubmitError('Please search for an address first.')
			return
		}
		if (!period) {
			setSubmitError('Please select a notification frequency.')
			return
		}
		setSubmitting(true)
		setSubmitError(null)
		try {
			const slugs = selectedProduceTypes()
			const locationName =
				geocodeResult()?.displayName ?? props.initialValues?.locationName ?? ''
			await props.onSubmit({
				locationName,
				throttlePeriod: period.value,
				centerH3: h3,
				resolution: resolution,
				ringSize: ringSize(),
				produceTypes: slugs.length > 0 ? slugs : undefined,
			})
		} catch (err) {
			Sentry.captureException(err)
			setSubmitError('Failed to save. Please try again.')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<form class="subscription-form" onSubmit={handleSubmit}>
			<div class="subscription-form__field">
				<label class="form-field__label" for="address-query">
					Address or zip code
				</label>
				<div class="subscription-form__address-row">
					<input
						ref={addressInputRef}
						id="address-query"
						type="text"
						class="form-field__control"
						value={addressQuery()}
						onInput={(e) => setAddressQuery(e.currentTarget.value)}
						onKeyDown={(e) =>
							e.key === 'Enter' && (e.preventDefault(), handleSearch())
						}
						placeholder="e.g. Napa, CA or 94558"
					/>
					<button
						type="button"
						class="subscription-form__search-button"
						onClick={handleSearch}
						disabled={geocoding() || !hydrated()}
						aria-label="Search"
					>
						{geocoding() ? 'Searching…' : 'Search'}
					</button>
				</div>
				<Show when={geocodeError()}>
					<p class="form-field__error" role="alert">
						{geocodeError()}
					</p>
				</Show>
				<Show when={geocodeResult()}>
					{(result) => (
						<p class="subscription-form__geocode-result" role="status">
							{result().displayName}
						</p>
					)}
				</Show>
				<Show when={props.initialValues?.centerH3 && !geocodeResult()}>
					<p class="subscription-form__geocode-result">
						{props.initialValues?.locationName || 'Saved area'}
					</p>
				</Show>
			</div>

			<input type="hidden" name="resolution" value={resolution} />

			<div class="subscription-form__field">
				<label class="form-field__label" for="ring-size">
					Coverage radius
				</label>
				<div class="subscription-form__range-row">
					<input
						id="ring-size"
						name="ringSize"
						type="range"
						min="0"
						max="6"
						step="1"
						value={ringSize()}
						onInput={(e) => setRingSize(Number(e.currentTarget.value))}
					/>
				</div>
				<span class="subscription-form__range-label">
					{RING_SIZE_LABELS[ringSize()]}
				</span>
			</div>

			<SubscriptionCoverageMap
				centerH3={centerH3()}
				ringSize={ringSize()}
				onRecenter={(newCenter) => {
					const [lat, lng] = cellToLatLng(newCenter)
					setGeocodeResult({ lat, lng, displayName: 'Selected on map' })
				}}
			/>

			<ProduceTypeMultiSelect
				value={selectedProduceTypes()}
				onChange={setSelectedProduceTypes}
			/>

			<Select
				name="throttlePeriod"
				label="Notification frequency"
				required
				options={THROTTLE_OPTIONS}
				value={throttlePeriod()}
				onChange={(opt) => setThrottlePeriod(opt)}
				optionValue="value"
				optionTextValue="label"
				itemComponent={(itemProps) => (
					<SelectItem item={itemProps.item}>
						<SelectItemLabel>{itemProps.item.rawValue.label}</SelectItemLabel>
					</SelectItem>
				)}
				renderValue={(opt) => opt?.label ?? ''}
			/>

			<Input disabled label="Deliver to" type="url" value={user()?.email} />

			<Show when={submitError()}>
				<p class="form-field__error" role="alert">
					{submitError()}
				</p>
			</Show>

			<button
				type="submit"
				class="subscription-form__submit"
				disabled={submitting() || geocoding()}
			>
				{submitting() ? 'Saving…' : 'Save subscription'}
			</button>
		</form>
	)
}
