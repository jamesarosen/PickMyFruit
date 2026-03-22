import { createEffect, createSignal, on, Show } from 'solid-js'
import { Link, useNavigate, useRouteContext } from '@tanstack/solid-router'
import { z } from 'zod'
import { Input, Textarea } from '@/components/FormField'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import ProduceTypeSelector from '@/components/ProduceTypeSelector'
import type { AddressFields } from '@/data/schema'
import { authClient } from '@/lib/auth-client'
import { Sentry } from '@/lib/sentry'
import { listingFormSchema } from '@/lib/validation'
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

	const isAuthenticated = () => Boolean(context().session?.user)
	const isSubmitting = () => formState() === 'submitting'

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
		}

		const parsed = listingFormSchema.safeParse(data)
		if (!parsed.success) {
			const tree = z.treeifyError(parsed.error)
			setFieldErrors(tree)
			if (tree.errors.length > 0) setSubmitError(tree.errors.join(' '))
			return
		}

		if (isAuthenticated()) {
			await submitListing(parsed.data)
		} else {
			// Validate email before triggering the magic-link flow
			const emailParsed = emailSchema.safeParse(email().trim())
			if (!emailParsed.success) {
				setEmailError(
					z.treeifyError(emailParsed.error).errors[0] ??
						'Please enter a valid email address'
				)
				return
			}

			// Store form data so it can be auto-submitted after magic link auth
			try {
				sessionStorage.setItem(PENDING_LISTING_KEY, JSON.stringify(parsed.data))
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
				<ErrorMessage class="form-message error" error={submitError()} />

				<Show when={!isAuthenticated()}>
					<Input
						disabled={isSubmitting()}
						errors={emailError() ? [emailError()!] : undefined}
						label="Your email"
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
						<ProduceTypeSelector
							errorMessage={fieldErrors().properties?.type?.errors?.[0]}
							name="type"
							onChange={setSelectedType}
							value={selectedType()}
						/>

						<Input
							errors={fieldErrors().properties?.harvestWindow?.errors}
							label="When to Pick"
							name="harvestWindow"
							placeholder="e.g., Now through February"
							required
						/>
					</div>
				</fieldset>

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
					<button type="submit" class="submit-button" disabled={isSubmitting()}>
						{isSubmitting() ? 'Submitting…' : 'Share my produce'}
					</button>
					<Link to="/" class="cancel-button">
						Cancel
					</Link>
				</div>
			</form>
		</Show>
	)
}
