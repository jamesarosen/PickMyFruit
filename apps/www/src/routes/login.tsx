import { createFileRoute, Link, useNavigate } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import Layout from '@/components/Layout'
import { authClient, useSession } from '@/lib/auth-client'
import './login.css'

export const Route = createFileRoute('/login')({
	component: LoginPage,
})

function LoginPage() {
	const session = useSession()
	const navigate = useNavigate()
	const [email, setEmail] = createSignal('')
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [emailSent, setEmailSent] = createSignal(false)

	// If already logged in, redirect to My Garden
	if (session().data?.user) {
		navigate({ to: '/my/garden' })
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		setError(null)

		const emailValue = email().trim()
		if (!emailValue) {
			setError('Please enter your email address')
			return
		}

		setIsSubmitting(true)
		try {
			await authClient.signIn.magicLink({
				email: emailValue,
				callbackURL: '/my/garden',
			})
			setEmailSent(true)
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send sign-in link')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<Layout title="Sign In - Pick My Fruit">
			<main class="login-page">
				<div class="login-container">
					<header class="login-header">
						<Link to="/" class="logo">
							<span class="logo-icon">🍑</span>
							<span class="logo-text">Pick My Fruit</span>
						</Link>
					</header>

					<Show
						when={!emailSent()}
						fallback={
							<div class="email-sent">
								<h1>Check your email</h1>
								<p>
									We sent a sign-in link to <strong>{email()}</strong>.
								</p>
								<p>Click the link in the email to sign in.</p>
								<div class="email-sent-actions">
									<button
										type="button"
										class="resend-button"
										onClick={async () => {
											await authClient.signIn.magicLink({
												email: email(),
												callbackURL: '/my/garden',
											})
										}}
									>
										Resend email
									</button>
									<button
										type="button"
										class="back-button"
										onClick={() => {
											setEmailSent(false)
											setEmail('')
										}}
									>
										Use different email
									</button>
								</div>
							</div>
						}
					>
						<div class="login-content">
							<h1>Sign in to Pick My Fruit</h1>
							<p>Enter your email and we'll send you a sign-in link.</p>

							<form class="login-form" onSubmit={handleSubmit}>
								<Show when={error()}>
									<div class="form-error">{error()}</div>
								</Show>

								<div class="form-group">
									<label for="email">Email address</label>
									<input
										type="email"
										id="email"
										name="email"
										placeholder="you@example.com"
										value={email()}
										onInput={(e) => setEmail(e.currentTarget.value)}
										required
										autofocus
									/>
								</div>

								<button type="submit" class="submit-button" disabled={isSubmitting()}>
									{isSubmitting() ? 'Sending…' : 'Send sign-in link'}
								</button>
							</form>

							<p class="login-footer">
								Don't have fruit to share yet?{' '}
								<Link to="/garden/new">List your first tree</Link>
							</p>
						</div>
					</Show>
				</div>
			</main>
		</Layout>
	)
}
