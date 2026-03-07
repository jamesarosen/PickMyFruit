import { createEffect, createSignal, on, Show } from 'solid-js'
import { useRouteContext } from '@tanstack/solid-router'
import { submitInquiry as submitInquiryFn } from '@/api/inquiries'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import { authClient } from '@/lib/auth-client'
import { Sentry } from '@/lib/sentry'
import { Input, Textarea } from './FormField'
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

	const isAuthenticated = () => Boolean(context().session?.user)

	async function submitInquiry() {
		setFormState('submitting')
		setError(null)

		try {
			await submitInquiryFn({
				data: {
					listingId: props.listingId,
					note: note() || undefined,
				},
			})

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
			try {
				sessionStorage.setItem(
					PENDING_INQUIRY_KEY,
					JSON.stringify({
						listingId: props.listingId,
						note: note(),
					})
				)
			} catch {
				// QuotaExceededError or similar — not fatal, continue with magic link flow
			}

			// Trigger magic link flow
			const emailValue = email().trim()
			if (!emailValue) {
				setError('Email is required')
				return
			}

			const { error } = await authClient.signIn.magicLink({
				email: emailValue,
				callbackURL: `${props.callbackURL}?inquiry_complete=true`,
			})

			if (error) {
				Sentry.captureException(new Error('Failed to send magic link'), {
					extra: { cause: error, context: 'InquiryForm' },
				})
				setError("Failed to send sign-in link. We've been notified of the problem.")
				setFormState('error')
			} else {
				setFormState('awaiting-magic-link')
			}
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

	// Auto-submit pending inquiry when returning from magic link authentication.
	// Clear the URL param after triggering to prevent re-submission on remount.
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
					// Guard: only auto-submit if the stored inquiry is for this listing.
					// The user may have opened a different listing before clicking the link.
					if (parsed.listingId !== props.listingId) {
						sessionStorage.removeItem(PENDING_INQUIRY_KEY)
						return
					}
					storedNote = parsed.note || ''
				} catch {
					sessionStorage.removeItem(PENDING_INQUIRY_KEY)
					return
				}

				hasAutoSubmitted = true
				setNote(storedNote)
				// Remove the param so re-mounting doesn't trigger a second submit.
				// Use the History API directly — this param is not part of the typed
				// TanStack Router search schema for this route.
				const url = new URL(window.location.href)
				url.searchParams.delete('inquiry_complete')
				window.history.replaceState({}, '', url.toString())
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
						<Input
							disabled={formState() === 'submitting'}
							label="Your email"
							onChange={setEmail}
							placeholder="you@example.com"
							required
							value={email()}
						/>
					</Show>

					<Textarea
						disabled={formState() === 'submitting'}
						hint={<span class="char-count">{note().length}/500</span>}
						label={
							<>
								Message to owner <span class="optional">(optional)</span>
							</>
						}
						maxLength={500}
						onChange={setNote}
						placeholder="Hi! I'd love to pick some of your fruit..."
						rows={3}
						value={note()}
					/>

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
