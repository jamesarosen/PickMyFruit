import { createEffect, createSignal, on, onMount, Show } from 'solid-js'
import { Link, useNavigate, useRouteContext } from '@tanstack/solid-router'
import { z } from 'zod'
import { Input, Textarea } from '@/components/FormField'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import ProduceTypeSelector from '@/components/ProduceTypeSelector'
import type { AddressFields } from '@/data/schema.server'
import { authClient } from '@/lib/auth-client'
import { Sentry } from '@/lib/sentry'
import { geocodeAddress, GeocodingNotFoundError } from '@/lib/geocoding'
import { listingFormSchema } from '@/lib/validation'
import { PRODUCE_STAND_SLUG } from '@/lib/produce-types'
import '@/components/ListingForm.css'

type FieldErrors = ReturnType<
	typeof z.treeifyError<z.infer<typeof listingFormSchema>>
>

type FormState = 'initial' | 'awaiting-magic-link' | 'submitting' | 'error'

const PENDING_LISTING_KEY = 'pendingListing'

/**
 * After magic-link auth, the server redirects here. The `listing_complete`
 * param signals the `createEffect` below to auto-submit the stored listing.
 * It is intentionally outside TanStack Router's typed search schema because
 * it is written and consumed by the History API, not the router.
 */
const CALLBACK_URL = '/listings/new?listing_complete=true'

const emailSchema = z.string().email('Please enter a valid email address')

export default function ListingForm(props: { defaultAddress?: AddressFields }) {
	const context = useRouteContext({ from: '__root__' })
	const navigate = useNavigate()
	const [formState, setFormState] = createSignal<FormState>('initial')
	const [submitError, setSubmitError] = createErrorSignal()
	const [fieldErrors, setFieldErrors] = createSignal<FieldErrors>({ errors: [] })
	const [selectedType, setSelectedType] = createSignal<string>('')
	const [email, setEmail] = createSignal('')
	const [emailError, setEmailError] = createSignal<string | null>(null)

	// A produce stand is simply the `produce-stand` produce type. It unlocks the
	// drop-off option; the address-release policy stays an independent choice.
	const isStand = () => selectedType() === PRODUCE_STAND_SLUG

	const isAuthenticated = () => Boolean(context().session?.user)
	const isSubmitting = () => formState() === 'submitting'
	// Kobalte's Combobox generates IDs internally; SSR and CSR counters diverge,
	// causing silent hydration failure that strips all event handlers from the
	// trigger. Render the selector fresh on the client only to sidestep this.
	const [clientMounted, setClientMounted] = createSignal(false)
	onMount(() => setClientMounted(true))

	async function submitListing(data: Record<string, unknown>) {
		setFormState('submitting')
		try {
			const response = await fetch('/api/listings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			})
			let responseData: Record<string, unknown>
			try {
				responseData = await response.json()
			} catch {
				throw new Error('Failed to create listing')
			}
			if (!response.ok) {
				throw new Error(
					typeof responseData.error === 'string'
						? responseData.error
						: 'Failed to create listing'
				)
			}
			sessionStorage.removeItem(PENDING_LISTING_KEY)
			navigate({
				to: '/listings/$id',
				params: { id: String(responseData.id) },
				search: { created: true },
			})
		} catch (error) {
			Sentry.captureException(error)
			setSubmitError(error instanceof Error ? error.message : 'An error occurred')
			setFormState('error')
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		if (isSubmitting()) return
		setSubmitError(null)
		setFieldErrors({ errors: [] })

		const form = event.target as HTMLFormElement
		const formData = new FormData(form)

		const data = {
			type: selectedType(),
			harvestWindow: formData.get('harvestWindow'),
			address: formData.get('address'),
			city: formData.get('city'),
			state: formData.get('state'),
			zip: formData.get('zip'),
			notes: formData.get('notes'),
			addressReleasePolicy: formData.get('addressReleasePolicy') ?? undefined,
			// Drop-offs only apply to the produce-stand type.
			acceptsDropOffs: isStand() ? formData.get('acceptsDropOffs') != null : false,
			tosAcknowledged: formData.get('tosAcknowledged') != null,
		}

		const parsed = listingFormSchema.safeParse(data)
		if (!parsed.success) {
			const tree = z.treeifyError(parsed.error)
			setFieldErrors(tree)
			if (tree.errors.length > 0) setSubmitError(tree.errors.join(' '))
			return
		}

		// Geocode before any auth check so failures surface immediately and
		// the coords are stored in sessionStorage for the unauth round-trip.
		setFormState('submitting')
		let geocoded: { lat: number; lng: number }
		try {
			const result = await geocodeAddress(parsed.data)
			geocoded = {
				lat: result.lat,
				lng: result.lng,
			}
		} catch (err) {
			if (err instanceof GeocodingNotFoundError) {
				setSubmitError(err.message)
			} else {
				Sentry.captureException(err)
				setSubmitError('Could not look up your address. Please try again.')
			}
			setFormState('error')
			return
		}

		const listingData = { ...parsed.data, ...geocoded }

		if (isAuthenticated()) {
			await submitListing(listingData)
		} else {
			// Read the email from the native form element rather than the signal.
			// Kobalte's controlled TextField onChange may not fire if the component
			// fails to hydrate, leaving the signal stale while the native value is correct.
			const emailFromForm = ((formData.get('email') as string) ?? '').trim()
			if (emailFromForm) setEmail(emailFromForm)

			const emailParsed = emailSchema.safeParse(emailFromForm)
			if (!emailParsed.success) {
				setEmailError(
					z.treeifyError(emailParsed.error).errors[0] ??
						'Please enter a valid email address'
				)
				setFormState('initial')
				return
			}

			// Store form data (including geocoded coords) so it can be auto-submitted
			// after magic link auth without re-geocoding.
			try {
				sessionStorage.setItem(PENDING_LISTING_KEY, JSON.stringify(listingData))
			} catch {
				// QuotaExceededError or similar — not fatal, continue with magic link flow
			}

			const { error } = await authClient.signIn.magicLink({
				email: emailParsed.data,
				callbackURL: CALLBACK_URL,
			})

			if (error) {
				setSubmitError(error)
				setFormState('error')
			} else {
				setFormState('awaiting-magic-link')
			}
		}
	}

	function handleMagicLinkCancel() {
		setFormState('initial')
		sessionStorage.removeItem(PENDING_LISTING_KEY)
	}

	async function handleMagicLinkVerified() {
		// Guard against the double-submit race where createEffect also fires
		// (e.g. the user opened the email link in the same tab before entering
		// the token, leaving listing_complete=true in the URL).
		if (isSubmitting()) return

		const pending = sessionStorage.getItem(PENDING_LISTING_KEY)
		if (!pending) return

		let data: Record<string, unknown>
		try {
			data = JSON.parse(pending)
		} catch {
			sessionStorage.removeItem(PENDING_LISTING_KEY)
			setSubmitError(
				'Your listing data could not be recovered. Please fill out the form again.'
			)
			setFormState('error')
			return
		}

		await submitListing(data)
	}

	// Auto-submit pending listing when returning from magic link authentication.
	// Fires on mount if the user arrived via the email link (session already set,
	// listing_complete=true in URL). Clear the param via History API to prevent
	// re-submission on remount — hasAutoSubmitted is defence-in-depth.
	let hasAutoSubmitted = false
	createEffect(
		on(
			() => context().session?.user,
			(user) => {
				if (!user || hasAutoSubmitted || typeof window === 'undefined') return

				const urlParams = new URLSearchParams(window.location.search)
				if (urlParams.get('listing_complete') !== 'true') return

				const pending = sessionStorage.getItem(PENDING_LISTING_KEY)
				if (!pending) return

				let data: Record<string, unknown>
				try {
					data = JSON.parse(pending)
				} catch {
					sessionStorage.removeItem(PENDING_LISTING_KEY)
					return
				}

				hasAutoSubmitted = true
				// Remove the param so re-mounting doesn't trigger a second submit.
				const url = new URL(window.location.href)
				url.searchParams.delete('listing_complete')
				window.history.replaceState({}, '', url.toString())
				void (async () => {
					await submitListing(data)
				})()
			}
		)
	)

	return (
		<Show
			when={formState() !== 'awaiting-magic-link'}
			fallback={
				<MagicLinkWaiting
					email={email()}
					callbackURL={CALLBACK_URL}
					onCancel={handleMagicLinkCancel}
					onVerified={handleMagicLinkVerified}
				/>
			}
		>
			<form class="listing-form" onSubmit={handleSubmit}>
				<ErrorMessage error={submitError()} />

				<Show when={!isAuthenticated()}>
					<Input
						disabled={isSubmitting()}
						errors={emailError() ? [emailError()!] : undefined}
						label="Your email"
						name="email"
						onChange={(v) => {
							setEmail(v)
							setEmailError(null)
						}}
						placeholder="you@example.com"
						required
						value={email()}
					/>
				</Show>

				<fieldset>
					<legend>What are you sharing?</legend>
					<div class="form-row">
						<Show when={clientMounted()}>
							<ProduceTypeSelector
								errorMessage={fieldErrors().properties?.type?.errors?.[0]}
								name="type"
								onChange={setSelectedType}
								value={selectedType()}
							/>
						</Show>

						<Input
							errors={fieldErrors().properties?.harvestWindow?.errors}
							label="When to Pick"
							name="harvestWindow"
							placeholder="e.g., Now through February"
							required
						/>
					</div>
				</fieldset>

				<Show when={isStand()}>
					<fieldset class="stand-fieldset">
						<legend>Stand details</legend>
						<label class="address-release-option">
							<input type="checkbox" name="acceptsDropOffs" checked />
							<span class="address-release-option-text">
								<span class="address-release-option-label">Accept drop-offs too</span>
								<span class="address-release-option-description">
									Let verified members leave produce here, not just take it. A one-way
									(take-only) stand is fine too — uncheck this.
								</span>
							</span>
						</label>
						<p class="stand-restriction">
							Drop-offs must obey local law and the listing's restrictions: all
							listings are limited to <strong>raw, whole, uncut produce</strong>.
						</p>
						<label class="address-release-option stand-tos">
							<input type="checkbox" name="tosAcknowledged" />
							<span class="address-release-option-text">
								<span class="address-release-option-label">
									I'll keep this stand to raw, whole produce
								</span>
								<span class="address-release-option-description">
									You're the accountable steward for this stand.
								</span>
							</span>
						</label>
						<Show when={fieldErrors().properties?.tosAcknowledged?.errors?.length}>
							<ErrorMessage
								error={fieldErrors().properties?.tosAcknowledged?.errors?.[0]}
							/>
						</Show>
					</fieldset>
				</Show>

				<fieldset>
					<legend>Where is it?</legend>

					<Show when={props.defaultAddress?.address}>
						<p class="form-prefill-notice" id="address-prefill-notice">
							Pre-filled from your last listing. Edit if different.
						</p>
					</Show>

					<Input
						aria-describedby={
							props.defaultAddress?.address ? 'address-prefill-notice' : undefined
						}
						defaultValue={props.defaultAddress?.address ?? ''}
						errors={fieldErrors().properties?.address?.errors}
						hint="Others will see your neighborhood, but not your exact address."
						label="Street Address"
						name="address"
						placeholder="123 Main Street"
						required
					/>

					<div class="form-row-3">
						<Input
							defaultValue={props.defaultAddress?.city ?? 'Napa'}
							errors={fieldErrors().properties?.city?.errors}
							label="City"
							name="city"
							required
						/>
						<Input
							defaultValue={props.defaultAddress?.state ?? 'CA'}
							errors={fieldErrors().properties?.state?.errors}
							label="State"
							maxlength={2}
							name="state"
							required
						/>
						<Input
							defaultValue={props.defaultAddress?.zip ?? ''}
							errors={fieldErrors().properties?.zip?.errors}
							label="ZIP"
							name="zip"
							placeholder="94558"
						/>
					</div>
				</fieldset>

				<fieldset class="address-release-fieldset">
					<legend>How is your address shared?</legend>
					<label class="address-release-option">
						<input
							type="radio"
							name="addressReleasePolicy"
							value="on_owner_approval"
							checked
						/>
						<span class="address-release-option-text">
							<span class="address-release-option-label">Approve each request</span>
							<span class="address-release-option-description">
								You approve every request before your address is shared.
							</span>
						</span>
					</label>
					<label class="address-release-option">
						<input
							type="radio"
							name="addressReleasePolicy"
							value="on_verified_request"
						/>
						<span class="address-release-option-text">
							<span class="address-release-option-label">
								Share with verified members
							</span>
							<span class="address-release-option-description">
								Any signed-in member with a verified email sees this address without
								asking.
								<br />
								<strong>Treat the location as effectively public</strong> — members can
								reshare it.
							</span>
						</span>
					</label>
				</fieldset>

				<fieldset>
					<legend>Notes</legend>
					<Textarea
						errors={fieldErrors().properties?.notes?.errors}
						label="Additional Details"
						name="notes"
						placeholder="e.g., Ring doorbell first. Take a few or take 'em all!"
						rows={3}
					/>
				</fieldset>

				<div class="form-actions">
					<button
						type="submit"
						class="button button--primary"
						disabled={isSubmitting()}
					>
						{isSubmitting() ? 'Submitting…' : 'Share my produce'}
					</button>
					<Link to="/" class="button button--ghost">
						Cancel
					</Link>
				</div>
			</form>
		</Show>
	)
}
