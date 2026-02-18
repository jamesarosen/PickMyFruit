import { createEffect, createSignal, on, Show } from 'solid-js'
import { useRouteContext } from '@tanstack/solid-router'
import { authClient } from '@/lib/auth-client'
import { submitInquiry as submitInquiryFn } from '@/api/inquiries'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import '@/components/InquiryForm.css'

interface InquiryFormProps {
	listingId: number
	callbackURL: string
}

type FormState =
	| 'initial'
	| 'awaiting-magic-link'
	| 'submitting'
	| 'success'
	| 'rate-limited'
	| 'error'

const PENDING_INQUIRY_KEY = 'pendingInquiry'

export default function InquiryForm(props: InquiryFormProps) {
	const context = useRouteContext({ from: '__root__' })
	const [formState, setFormState] = createSignal<FormState>('initial')
	const [email, setEmail] = createSignal('')
	const [note, setNote] = createSignal('')
	const [error, setError] = createSignal<string | null>(null)
	const [emailSent, setEmailSent] = createSignal(true)

	const isAuthenticated = () => Boolean(context().session?.user)

	async function submitInquiry() {
		setFormState('submitting')
		setError(null)

		try {
			const result = await submitInquiryFn({
				data: {
					listingId: props.listingId,
					note: note() || undefined,
				},
			})

			setEmailSent(result.emailSent)
			setFormState('success')
			sessionStorage.removeItem(PENDING_INQUIRY_KEY)
		} catch (err) {
			const message =
				err instanceof Error ? err.message : 'Failed to submit inquiry'
			if (message.includes('already contacted') || message.includes('24 hours')) {
				setFormState('rate-limited')
				return
			}
			setError(message)
			setFormState('error')
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault()

		if (isAuthenticated()) {
			await submitInquiry()
		} else {
			// Store pending inquiry data
			sessionStorage.setItem(
				PENDING_INQUIRY_KEY,
				JSON.stringify({
					listingId: props.listingId,
					note: note(),
				})
			)

			// Trigger magic link flow
			const emailValue = email().trim()
			if (!emailValue) {
				setError('Email is required')
				return
			}

			setFormState('awaiting-magic-link')
			await authClient.signIn.magicLink({
				email: emailValue,
				callbackURL: `${props.callbackURL}?inquiry_complete=true`,
			})
		}
	}

	function handleMagicLinkCancel() {
		setFormState('initial')
		sessionStorage.removeItem(PENDING_INQUIRY_KEY)
	}

	async function handleMagicLinkVerified() {
		// Auto-submit the stored inquiry
		await submitInquiry()
	}

	// Auto-submit pending inquiry when returning from magic link authentication
	let hasAutoSubmitted = false
	createEffect(
		on(
			() => context().session?.user,
			(user) => {
				if (!user || hasAutoSubmitted || typeof window === 'undefined') return

				const urlParams = new URLSearchParams(window.location.search)
				if (urlParams.get('inquiry_complete') !== 'true') return

				const pending = sessionStorage.getItem(PENDING_INQUIRY_KEY)
				if (!pending) return

				let storedNote: string
				try {
					const parsed = JSON.parse(pending)
					storedNote = parsed.note || ''
				} catch {
					sessionStorage.removeItem(PENDING_INQUIRY_KEY)
					return
				}

				hasAutoSubmitted = true
				setNote(storedNote)
				submitInquiry()
			}
		)
	)

	return (
		<div class="inquiry-form-container">
			<Show when={formState() === 'awaiting-magic-link'}>
				<MagicLinkWaiting
					email={email()}
					callbackURL={`${props.callbackURL}?inquiry_complete=true`}
					onCancel={handleMagicLinkCancel}
					onVerified={handleMagicLinkVerified}
				/>
			</Show>

			<Show when={formState() === 'success'}>
				<div class="inquiry-success">
					<h3>Request sent!</h3>
					<p>The owner has been notified and will reach out to you soon.</p>
					<Show when={!emailSent()}>
						<p class="email-warning">
							Note: There was an issue sending the email, but your request was
							recorded. The owner will see it when they check their listings.
						</p>
					</Show>
				</div>
			</Show>

			<Show when={formState() === 'rate-limited'}>
				<div class="inquiry-rate-limited">
					<h3>Already contacted</h3>
					<p>
						You've already reached out to this owner recently. Please wait 24 hours
						before trying again.
					</p>
				</div>
			</Show>

			<Show
				when={
					formState() === 'initial' ||
					formState() === 'submitting' ||
					formState() === 'error'
				}
			>
				<form class="inquiry-form" onSubmit={handleSubmit}>
					<h3>Interested in this fruit?</h3>

					<Show when={!isAuthenticated()}>
						<div class="form-field">
							<label for="inquiry-email">Your email</label>
							<input
								type="email"
								id="inquiry-email"
								value={email()}
								onInput={(e) => setEmail(e.currentTarget.value)}
								placeholder="you@example.com"
								required
								disabled={formState() === 'submitting'}
							/>
						</div>
					</Show>

					<div class="form-field">
						<label for="inquiry-note">
							Message to owner <span class="optional">(optional)</span>
						</label>
						<textarea
							id="inquiry-note"
							value={note()}
							onInput={(e) => setNote(e.currentTarget.value)}
							placeholder="Hi! I'd love to pick some of your fruit..."
							maxLength={500}
							rows={3}
							disabled={formState() === 'submitting'}
						/>
						<span class="char-count">{note().length}/500</span>
					</div>

					<Show when={error()}>
						<div class="inquiry-error">{error()}</div>
					</Show>

					<button
						type="submit"
						class="inquiry-submit"
						disabled={formState() === 'submitting'}
					>
						{formState() === 'submitting' ? 'Sending...' : 'Put me in touch'}
					</button>
				</form>
			</Show>
		</div>
	)
}
