import { createFileRoute, Link, redirect } from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import Layout from '@/components/Layout'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import { authClient } from '@/lib/auth-client'
import './login.css'

export const Route = createFileRoute('/login')({
	beforeLoad: ({ context }) => {
		if (context.session?.user) {
			throw redirect({ to: '/garden/mine' })
		}
	},
	component: LoginPage,
})

function LoginPage() {
	const [email, setEmail] = createSignal('')
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [error, setError] = createSignal<string | null>(null)
	const [emailSent, setEmailSent] = createSignal(false)

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
				callbackURL: '/garden/mine',
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
							<MagicLinkWaiting
								email={email()}
								callbackURL="/garden/mine"
								onCancel={() => {
									setEmailSent(false)
									setEmail('')
								}}
							/>
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
