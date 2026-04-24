import { createMemo, createSignal, For, Show } from 'solid-js'
import { useNavigate } from '@tanstack/solid-router'
import { Input } from '@/components/FormField'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'
import {
	createMySubscription,
	geocodeForSubscription,
} from '@/api/notifications'
import {
	buildCreateSubscriptionData,
	buildLocationConfirmationText,
	type GeocodedSubscriptionLocation,
} from '@/lib/subscription-draft'
import { produceTypes } from '@/lib/produce-types'
import { UserError } from '@/lib/user-error'
import '@/components/ListingForm.css'
import '@/components/SubscriptionForm.css'

type FormState = 'idle' | 'searching' | 'submitting'

export default function SubscriptionForm() {
	const navigate = useNavigate()
	const [formState, setFormState] = createSignal<FormState>('idle')
	const [address, setAddress] = createSignal('')
	const [label, setLabel] = createSignal('')
	const [selectedType, setSelectedType] = createSignal('')
	const [location, setLocation] =
		createSignal<GeocodedSubscriptionLocation | null>(null)
	const [searchError, setSearchError] = createErrorSignal()
	const [submitError, setSubmitError] = createErrorSignal()

	const isSearching = () => formState() === 'searching'
	const isSubmitting = () => formState() === 'submitting'
	const canSubmit = () =>
		Boolean(location()) && !isSubmitting() && !isSearching()
	const confirmationText = createMemo(() => {
		const found = location()
		return found ? buildLocationConfirmationText(found.displayName, 1) : ''
	})

	async function handleSearch(event: SubmitEvent) {
		event.preventDefault()
		if (isSearching() || isSubmitting()) return

		setSearchError(null)
		setSubmitError(null)
		setLocation(null)
		setFormState('searching')

		try {
			const query = address().trim()
			const found = await geocodeForSubscription({ data: query })
			if (!found) {
				setSearchError('Could not find that address — try a nearby city.')
				return
			}
			setLocation({
				lat: found.lat,
				lng: found.lng,
				displayName: found.displayName,
			})
		} catch (error) {
			if (error instanceof UserError && error.code === 'GEOCODING_ERROR') {
				setSearchError(error.message)
			} else {
				setSearchError(
					'Location search is temporarily unavailable — try again in a moment.'
				)
			}
		} finally {
			if (!isSubmitting()) {
				setFormState('idle')
			}
		}
	}

	async function handleCreateSubscription(event: SubmitEvent) {
		event.preventDefault()
		if (!canSubmit()) return
		const found = location()
		if (!found) return

		setSubmitError(null)
		setFormState('submitting')

		try {
			const payload = buildCreateSubscriptionData({
				label: label(),
				location: found,
				produceTypes: selectedType() ? [selectedType()] : null,
				ringSize: 1,
				throttlePeriod: 'immediately',
			})
			await createMySubscription({ data: payload })
			await navigate({ to: '/notifications' })
		} catch (error) {
			setSubmitError(error)
			setFormState('idle')
		}
	}

	return (
		<div class="subscription-form">
			<form class="subscription-form__search" onSubmit={handleSearch}>
				<Input
					label="Address"
					name="address"
					value={address()}
					onChange={(value) => {
						setAddress(value)
						setLocation(null)
						setSearchError(null)
					}}
					placeholder="City, state, or ZIP"
					required
					disabled={isSearching() || isSubmitting()}
				/>
				<button
					type="submit"
					class="subscription-form__search-button"
					disabled={isSearching() || isSubmitting() || !address().trim()}
				>
					{isSearching() ? 'Searching…' : 'Search'}
				</button>
			</form>

			<ErrorMessage class="subscription-form__message" error={searchError()} />

			<Show when={location()}>
				<p class="subscription-form__confirmation">{confirmationText()}</p>
			</Show>

			<form class="subscription-form__create" onSubmit={handleCreateSubscription}>
				<Input
					label="Label (optional)"
					name="label"
					value={label()}
					onChange={setLabel}
					placeholder="Backyard produce alerts"
					disabled={isSubmitting()}
				/>

				<div class="form-field">
					<label class="form-field__label" for="subscription-produce-type">
						Produce type (optional)
					</label>
					<select
						id="subscription-produce-type"
						class="form-field__control"
						name="produceType"
						value={selectedType()}
						onInput={(event) => setSelectedType(event.currentTarget.value)}
						disabled={isSubmitting()}
					>
						<option value="">All produce types</option>
						<For each={produceTypes}>
							{(type) => (
								<option value={type.slug}>{type.nameSingularTitleCase}</option>
							)}
						</For>
					</select>
				</div>

				<p class="subscription-form__summary">
					Delivery: Immediately (within ~1 hour)
				</p>

				<ErrorMessage class="subscription-form__message" error={submitError()} />

				<button
					type="submit"
					class="subscription-form__submit-button"
					disabled={!canSubmit()}
				>
					{isSubmitting() ? 'Creating…' : 'Create subscription'}
				</button>
			</form>
		</div>
	)
}
