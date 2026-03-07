import { Link, useNavigate, useRouteContext } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { z } from 'zod'
import { Input, Textarea } from '@/components/FormField'
import { Select, SelectItem, SelectItemLabel } from '@/components/Select'
import type { AddressFields } from '@/data/schema'
import { capitalize } from '@/lib/capitalize'
import { Sentry } from '@/lib/sentry'
import { listingFormSchema, fruitTypes } from '@/lib/validation'
import '@/components/ListingForm.css'

type FieldErrors = ReturnType<
	typeof z.treeifyError<z.infer<typeof listingFormSchema>>
>

export default function ListingForm(props: { defaultAddress?: AddressFields }) {
	const context = useRouteContext({ from: '__root__' })
	const navigate = useNavigate()
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [submitError, setSubmitError] = createSignal<string | null>(null)
	const [fieldErrors, setFieldErrors] = createSignal<FieldErrors>({ errors: [] })

	async function submitListing(data: Record<string, unknown>) {
		setIsSubmitting(true)
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
			navigate({
				to: '/listings/$id',
				params: { id: String(responseData.id) },
				search: { created: true },
			})
		} catch (error) {
			Sentry.captureException(error)
			setSubmitError(error instanceof Error ? error.message : 'An error occurred')
		} finally {
			setIsSubmitting(false)
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
			const tree = z.treeifyError(parsed.error)
			setFieldErrors(tree)
			if (tree.errors.length > 0) setSubmitError(tree.errors.join(' '))
			return
		}

		await submitListing(parsed.data)
	}

	return (
		<form class="listing-form" onSubmit={handleSubmit}>
			<Show when={submitError()}>
				<div role="alert" class="form-message error">
					{submitError()}
				</div>
			</Show>

			<Show when={context().session?.user}>
				{(user) => (
					<p class="form-identity">
						Posting as {user().name} ({user().email})
					</p>
				)}
			</Show>

			<fieldset>
				<legend>What are you sharing?</legend>
				<div class="form-row">
					<Select<string>
						errors={fieldErrors().properties?.type?.errors}
						itemComponent={(props) => (
							<SelectItem item={props.item}>
								<SelectItemLabel>{capitalize(props.item.rawValue)}</SelectItemLabel>
							</SelectItem>
						)}
						label="Fruit Type"
						name="type"
						options={[...fruitTypes]}
						placeholder="Select fruit type…"
						renderValue={capitalize}
						required
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
					{isSubmitting() ? 'Submitting…' : 'List My Fruit'}
				</button>
				<Link to="/" class="cancel-button">
					Cancel
				</Link>
			</div>
		</form>
	)
}
