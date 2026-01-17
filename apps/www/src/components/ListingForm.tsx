import { createSignal, Show, For, onMount } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { listingFormSchema, fruitTypes } from '@/lib/validation'
import { useSession, authClient } from '@/lib/auth-client'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import FormField, { capitalize } from '@/components/FormField'
import '@/components/ListingForm.css'

const PENDING_LISTING_KEY = 'pendingListing'

interface FieldErrors {
	[key: string]: string[] | undefined
}

export default function ListingForm() {
	const session = useSession()
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [submitError, setSubmitError] = createSignal<string | null>(null)
	const [isSuccess, setIsSuccess] = createSignal(false)
	const [fieldErrors, setFieldErrors] = createSignal<FieldErrors>({})
	const [awaitingMagicLink, setAwaitingMagicLink] = createSignal(false)
	const [magicLinkEmail, setMagicLinkEmail] = createSignal<string | null>(null)

	// Check if returning from magic link verification with pending listing
	onMount(async () => {
		const pending = sessionStorage.getItem(PENDING_LISTING_KEY)
		const params = new URLSearchParams(window.location.search)
		const isComplete = params.get('complete') === 'true'

		if (pending && isComplete && session().data?.user) {
			// User returned from magic link, auto-submit the form
			sessionStorage.removeItem(PENDING_LISTING_KEY)
			try {
				const data = JSON.parse(pending)
				await submitListing(data)
			} catch {
				setSubmitError('Failed to complete your listing. Please try again.')
			}
			// Clean up URL
			window.history.replaceState({}, '', window.location.pathname)
		}
	})

	async function submitListing(data: Record<string, unknown>) {
		setIsSubmitting(true)
		try {
			const response = await fetch('/api/listings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			})
			if (!response.ok) {
				const errorData = await response.json()
				throw new Error(errorData.error || 'Failed to create listing')
			}
			setIsSuccess(true)
		} catch (error) {
			setSubmitError(error instanceof Error ? error.message : 'An error occurred')
		} finally {
			setIsSubmitting(false)
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		setSubmitError(null)
		setFieldErrors({})

		const form = event.target as HTMLFormElement
		const formData = new FormData(form)

		const data = {
			type: formData.get('type'),
			harvestWindow: formData.get('harvestWindow'),
			address: formData.get('address'),
			city: formData.get('city'),
			state: formData.get('state'),
			zip: formData.get('zip'),
			ownerName: formData.get('ownerName'),
			ownerEmail: formData.get('ownerEmail'),
			notes: formData.get('notes'),
		}

		const parsed = listingFormSchema.safeParse(data)
		if (!parsed.success) {
			setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors)
			return
		}

		// If user is authenticated, submit directly
		if (session().data?.user) {
			await submitListing(parsed.data)
			return
		}

		// User not authenticated - send magic link
		setIsSubmitting(true)
		try {
			// Store form data for after auth
			sessionStorage.setItem(PENDING_LISTING_KEY, JSON.stringify(parsed.data))

			// Send magic link
			const email = parsed.data.ownerEmail
			await authClient.signIn.magicLink({
				email,
				callbackURL: '/garden/new?complete=true',
			})

			setMagicLinkEmail(email)
			setAwaitingMagicLink(true)
		} catch (error) {
			sessionStorage.removeItem(PENDING_LISTING_KEY)
			setSubmitError(
				error instanceof Error ? error.message : 'Failed to send verification email'
			)
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<Show
			when={!isSuccess()}
			fallback={
				<div class="success-content">
					<h2>Your fruit is listed!</h2>
					<p>
						Thanks for sharing with the community. We'll be in touch when a gleaner
						wants to pick.
					</p>
					<Link to="/" class="back-button">
						Back to Home
					</Link>
				</div>
			}
		>
			<Show
				when={!awaitingMagicLink()}
				fallback={
					<MagicLinkWaiting
						email={magicLinkEmail() ?? ''}
						callbackURL="/garden/new?complete=true"
						onCancel={() => {
							setAwaitingMagicLink(false)
							setMagicLinkEmail(null)
							sessionStorage.removeItem(PENDING_LISTING_KEY)
						}}
					/>
				}
			>
				<form class="listing-form" onSubmit={handleSubmit}>
					<Show when={submitError()}>
						<div class="form-message error">{submitError()}</div>
					</Show>

					<fieldset>
						<legend>What are you sharing?</legend>
						<div class="form-row">
							<FormField
								id="type"
								label="Fruit Type"
								required
								error={fieldErrors().type}
							>
								<select
									id="type"
									name="type"
									class={fieldErrors().type ? 'error' : ''}
									required
								>
									<option value="">Select fruit type</option>
									<For each={fruitTypes}>
										{(type) => <option value={type}>{capitalize(type)}</option>}
									</For>
								</select>
							</FormField>
							<FormField
								id="harvestWindow"
								label="When to Pick"
								required
								error={fieldErrors().harvestWindow}
							>
								<input
									type="text"
									id="harvestWindow"
									name="harvestWindow"
									placeholder="e.g., Now through February"
									class={fieldErrors().harvestWindow ? 'error' : ''}
									required
								/>
							</FormField>
						</div>
					</fieldset>

					<fieldset>
						<legend>Where is it?</legend>
						<FormField
							id="address"
							label="Street Address"
							required
							error={fieldErrors().address}
							hint="Others will see your neighborhood, but not your exact address."
						>
							<input
								type="text"
								id="address"
								name="address"
								placeholder="123 Main Street"
								class={fieldErrors().address ? 'error' : ''}
								required
							/>
						</FormField>
						<div class="form-row-3">
							<FormField id="city" label="City" required error={fieldErrors().city}>
								<input
									type="text"
									id="city"
									name="city"
									value="Napa"
									class={fieldErrors().city ? 'error' : ''}
									required
								/>
							</FormField>
							<FormField id="state" label="State" required error={fieldErrors().state}>
								<input
									type="text"
									id="state"
									name="state"
									value="CA"
									maxlength="2"
									class={fieldErrors().state ? 'error' : ''}
									required
								/>
							</FormField>
							<FormField id="zip" label="ZIP" error={fieldErrors().zip}>
								<input type="text" id="zip" name="zip" placeholder="94558" />
							</FormField>
						</div>
					</fieldset>

					<fieldset>
						<legend>How do we get in touch?</legend>
						<FormField
							id="ownerName"
							label="Your Name"
							required
							error={fieldErrors().ownerName}
						>
							<input
								type="text"
								id="ownerName"
								name="ownerName"
								placeholder="Jane Smith"
								value={session().data?.user?.name || ''}
								class={fieldErrors().ownerName ? 'error' : ''}
								required
							/>
						</FormField>
						<FormField
							id="ownerEmail"
							label="Email"
							required
							error={fieldErrors().ownerEmail}
							hint={
								session().data?.user
									? 'Signed in - your listing will be linked to this account'
									: 'Pick My Fruit will send you a link to verify'
							}
						>
							<input
								type="email"
								id="ownerEmail"
								name="ownerEmail"
								placeholder="jane@example.com"
								value={session().data?.user?.email || ''}
								class={fieldErrors().ownerEmail ? 'error' : ''}
								required
								readonly={Boolean(session().data?.user)}
							/>
						</FormField>
					</fieldset>

					<fieldset>
						<legend>Notes</legend>
						<FormField
							id="notes"
							label="Additional Details"
							error={fieldErrors().notes}
						>
							<textarea
								id="notes"
								name="notes"
								placeholder="e.g., Ring doorbell first. Take a few. Take 'em all! Gate code is 1234."
								rows="3"
							/>
						</FormField>
					</fieldset>

					<div class="form-actions">
						<button type="submit" class="submit-button" disabled={isSubmitting()}>
							{isSubmitting() ? 'Submitting…' : 'List My Fruit'}
						</button>
						<Link to="/" class="cancel-button">
							Cancel
						</Link>
					</div>
				</form>
			</Show>
		</Show>
	)
}
