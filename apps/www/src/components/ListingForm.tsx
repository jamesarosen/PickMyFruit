import { createSignal, Show, For } from 'solid-js'
import { Link } from '@tanstack/solid-router'
import { listingFormSchema, fruitTypes } from '@/lib/validation'
import { useSession } from '@/lib/auth-client'
import FormField, { capitalize } from '@/components/FormField'
import '@/components/ListingForm.css'

interface FieldErrors {
	[key: string]: string[] | undefined
}

export default function ListingForm() {
	const session = useSession()
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [submitError, setSubmitError] = createSignal<string | null>(null)
	const [isSuccess, setIsSuccess] = createSignal(false)
	const [fieldErrors, setFieldErrors] = createSignal<FieldErrors>({})

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
		if (isSubmitting()) return
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
			notes: formData.get('notes'),
		}

		const parsed = listingFormSchema.safeParse(data)
		if (!parsed.success) {
			setFieldErrors(parsed.error.flatten().fieldErrors as FieldErrors)
			return
		}

		await submitListing(parsed.data)
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
			<form class="listing-form" onSubmit={handleSubmit}>
				<Show when={submitError()}>
					<div class="form-message error">{submitError()}</div>
				</Show>

				<Show when={session().data?.user}>
					{(user) => (
						<p class="form-identity">
							Posting as {user().name} ({user().email})
						</p>
					)}
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
	)
}
