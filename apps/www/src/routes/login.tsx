import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
	useSearch,
} from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import { authClient } from '@/lib/auth-client'
import './login.css'

const loginSearchSchema = z.object({
	returnTo: z
		.string()
		.refine((val) => val.startsWith('/') && !val.startsWith('//'), {
			message: 'returnTo must be a relative path',
		})
		.optional(),
})

export const Route = createFileRoute('/login')({
	validateSearch: loginSearchSchema,
	beforeLoad: ({ context, search }) => {
		if (context.session?.user) {
			throw redirect({ to: search.returnTo || '/listings/mine' })
		}
	},
	component: LoginPage,
})

function LoginPage() {
	const navigate = useNavigate()
	const search = useSearch({ from: '/login' })
	const returnTo = () => search().returnTo || '/listings/mine'
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
				callbackURL: returnTo(),
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
								callbackURL={returnTo()}
								onCancel={() => {
									setEmailSent(false)
									setEmail('')
								}}
								onVerified={() => navigate({ to: returnTo() })}
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
								Once signed in, you can list your fruit trees with the community.
							</p>
						</div>
					</Show>
				</div>
			</main>
		</Layout>
	)
}
