import { createEffect, createSignal, on, Show } from 'solid-js'
import { useRouteContext, useRouter } from '@tanstack/solid-router'
import { submitInquiry as submitInquiryFn } from '@/api/inquiries'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import { authClient } from '@/lib/auth-client'
import { displayName } from '@/lib/display-name'
import { Sentry } from '@/lib/sentry'
import { produceTypes } from '@/lib/produce-types'
import { Input, Textarea } from './FormField'
import '@/components/InquiryForm.css'
import { createErrorSignal, ErrorMessage } from './ErrorMessage'

interface InquiryFormProps {
	listingId: number
	listingType: string
	callbackURL: string
}

type FormState =
	| 'initial'
	| 'awaiting-magic-link'
	| 'awaiting-name'
	| 'submitting'
	| 'success'
	| 'rate-limited'
	| 'error'

const PENDING_INQUIRY_KEY = 'pendingInquiry'

export default function InquiryForm(props: InquiryFormProps) {
	const plural = () =>
		produceTypes.find((t) => t.slug === props.listingType)
			?.namePluralSentenceCase ?? props.listingType

	const router = useRouter()
	const context = useRouteContext({ from: '__root__' })
	const [formState, setFormState] = createSignal<FormState>('initial')
	const [email, setEmail] = createSignal('')
	const [note, setNote] = createSignal('')
	const [nameValue, setNameValue] = createSignal('')
	const [error, setError] = createErrorSignal()

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
			const message = err instanceof Error ? err.message : ''
			if (message.includes('already contacted') || message.includes('24 hours')) {
				setFormState('rate-limited')
				return
			}
			setError(err)
			setFormState('error')
		}
	}

	/**
	 * After authentication, check if the user has a name. If not, pause to show
	 * the name interstitial before submitting the inquiry.
	 */
	function transitionAfterAuth(user: { name: string; email: string }) {
		if (!user.name.trim()) {
			setNameValue('')
			setFormState('awaiting-name')
		} else {
			void submitInquiry()
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault()

		if (isAuthenticated()) {
			// transitionAfterAuth checks user.name — shows interstitial for blank-name users
			transitionAfterAuth(context().session!.user!)
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
				setError(error)
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
		// Invalidate the router so the session is populated before we check user.name.
		// (The session cookie is set during verify but context() may not have updated yet.)
		await router.invalidate()
		const user = context().session?.user
		if (user) {
			transitionAfterAuth(user)
		} else {
			await submitInquiry()
		}
	}

	async function handleNameInterstitialSubmit(e: SubmitEvent) {
		e.preventDefault()
		const trimmed = nameValue().trim()
		const currentName = context().session?.user?.name ?? ''
		if (trimmed && trimmed !== currentName) {
			const { error: nameError } = await authClient.updateUser({ name: trimmed })
			// Non-fatal: a name save failure doesn't block the inquiry
			if (nameError) {
				Sentry.captureException(nameError, {
					extra: { context: 'name-interstitial' },
				})
			}
		}
		await submitInquiry()
	}

	// Move focus to the name interstitial form when it appears so keyboard and
	// screen reader users land on the new step automatically.
	let nameInterstitialRef: HTMLFormElement | undefined
	createEffect(() => {
		if (formState() === 'awaiting-name') nameInterstitialRef?.focus()
	})

	// Auto-submit pending inquiry when returning from magic link authentication
	// via the email link (inquiry_complete=true in URL). Clears the URL param after
	// triggering to prevent re-submission on remount — hasAutoSubmitted is defence-in-depth.
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
				transitionAfterAuth(user)
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

			<Show when={formState() === 'awaiting-name'}>
				<Show when={context().session?.user}>
					{(user) => {
						const previewName = () => nameValue().trim() || displayName(user())
						return (
							<form
								class="name-interstitial"
								tabindex="-1"
								ref={nameInterstitialRef}
								onSubmit={handleNameInterstitialSubmit}
							>
								<h3>Before we send your inquiry…</h3>
								<p class="name-interstitial-preview">
									The owner will receive:{' '}
									<strong>
										"{previewName()} wants your {props.listingType}"
									</strong>
									. Do you want to customize your name?
								</p>
								<Input
									name="name"
									label={
										<>
											Your name <span class="optional">(optional)</span>
										</>
									}
									value={nameValue()}
									onChange={setNameValue}
									maxlength={100}
								/>
								<div class="name-interstitial-actions">
									<button type="submit" class="inquiry-submit">
										Update name &amp; send inquiry
									</button>
									<button
										type="button"
										class="name-interstitial-skip"
										onClick={submitInquiry}
									>
										No thanks. Send the email as-is
									</button>
								</div>
							</form>
						)
					}}
				</Show>
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
					<h3>Interested in this produce?</h3>

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
						placeholder={`Hi! I'd love to pick some of your ${plural()}…`}
						rows={3}
						value={note()}
					/>

					<ErrorMessage
						class="inquiry-error"
						defaultMessage="Failed to submit inquiry"
						error={error()}
					/>

					<button
						type="submit"
						class="inquiry-submit"
						disabled={formState() === 'submitting'}
					>
						{formState() === 'submitting' ? 'Sending…' : 'Put me in touch'}
					</button>
				</form>
			</Show>
		</div>
	)
}
