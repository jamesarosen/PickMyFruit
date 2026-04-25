import { createSignal } from 'solid-js'
import { authClient } from '@/lib/auth-client'
import '@/components/MagicLinkWaiting.css'
import { createErrorSignal, ErrorMessage } from './ErrorMessage'

interface MagicLinkWaitingProps {
	email: string
	callbackURL: string
	onCancel: () => void
	onVerified: () => void | Promise<void>
}

// Refactoring signal: if this component gains 5+ state signals, retry logic,
// or complex state transitions, split into Container (logic) + Presenter (UI).

export default function MagicLinkWaiting(props: MagicLinkWaitingProps) {
	const [token, setToken] = createSignal('')
	const [isVerifying, setIsVerifying] = createSignal(false)
	const [isSending, setIsSending] = createSignal(false)
	const [error, setError] = createErrorSignal()
	const [resendError, setResendError] = createErrorSignal()

	async function handleVerifyToken(e: SubmitEvent) {
		e.preventDefault()
		const tokenValue = token().trim()
		if (!tokenValue) return

		setIsVerifying(true)
		setError(null)

		try {
			const result = await authClient.magicLink.verify({
				query: { token: tokenValue },
				fetchOptions: { redirect: 'manual' },
			})

			if (result.error) {
				setError(result.error)
				return
			}

			await props.onVerified()
		} finally {
			setIsVerifying(false)
		}
	}

	return (
		<div class="magic-link-waiting">
			<h2>Check your email</h2>
			<p>
				We sent a sign-in link to <strong>{props.email}</strong>.
			</p>
			<p>Click the link in the email to sign in.</p>

			<form class="token-form" onSubmit={handleVerifyToken}>
				<label for="magic-link-token">Or enter the token:</label>
				<div class="token-input-row">
					<input
						type="text"
						id="magic-link-token"
						name="token"
						value={token()}
						onInput={(e) => setToken(e.currentTarget.value)}
						placeholder="Paste token here"
						disabled={isVerifying()}
					/>
					<button
						type="submit"
						class="button button--primary button--sm"
						disabled={isVerifying()}
					>
						{isVerifying() ? 'Verifying…' : 'Verify'}
					</button>
				</div>
				<ErrorMessage
					class="token-error"
					defaultMessage="Invalid or expired token"
					error={error()}
				/>
			</form>

			<div class="actions">
				<button
					type="button"
					class="resend-button"
					disabled={isSending()}
					onClick={async () => {
						setResendError(null)
						setIsSending(true)
						const { error } = await authClient.signIn.magicLink({
							email: props.email,
							callbackURL: props.callbackURL,
						})
						if (error) {
							setResendError(error)
						}
						setIsSending(false)
					}}
				>
					{isSending() ? 'Sending…' : 'Resend email'}
				</button>
				<ErrorMessage
					class="resend-error"
					defaultMessage="Failed to resend. Please try again."
					error={resendError()}
				/>
				<button
					type="button"
					class="button button--ghost button--block"
					onClick={props.onCancel}
				>
					Use different email
				</button>
			</div>
		</div>
	)
}
