import { createSignal, Show } from 'solid-js'
import { authClient } from '@/lib/auth-client'
import '@/components/MagicLinkWaiting.css'

interface MagicLinkWaitingProps {
	email: string
	callbackURL: string
	onCancel: () => void
	onVerified?: () => void
}

export default function MagicLinkWaiting(props: MagicLinkWaitingProps) {
	const [token, setToken] = createSignal('')
	const [isVerifying, setIsVerifying] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)

	async function handleVerifyToken(e: SubmitEvent) {
		e.preventDefault()
		const tokenValue = token().trim()
		if (!tokenValue) {
			return
		}

		setIsVerifying(true)
		setError(null)

		try {
			const result = await authClient.magicLink.verify({
				query: {
					token: tokenValue,
				},
			})

			if (result.error) {
				setError(result.error.message || 'Invalid or expired token')
				return
			}

			// Verification successful
			if (props.onVerified) {
				props.onVerified()
			} else {
				window.location.href = props.callbackURL
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to verify token')
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
					<button type="submit" class="verify-button" disabled={isVerifying()}>
						{isVerifying() ? 'Verifying…' : 'Verify'}
					</button>
				</div>
				<Show when={error()}>
					<div class="token-error">{error()}</div>
				</Show>
			</form>

			<div class="actions">
				<button
					type="button"
					class="resend-button"
					onClick={async () => {
						await authClient.signIn.magicLink({
							email: props.email,
							callbackURL: props.callbackURL,
						})
					}}
				>
					Resend email
				</button>
				<button type="button" class="cancel-button" onClick={props.onCancel}>
					Use different email
				</button>
			</div>
		</div>
	)
}
