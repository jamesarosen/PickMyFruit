import {
	createFileRoute,
	redirect,
	useNavigate,
	useRouter,
	useSearch,
} from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import { z } from 'zod'
import { Input } from '@/components/FormField'
import Layout from '@/components/Layout'
import SiteHeader from '@/components/SiteHeader'
import MagicLinkWaiting from '@/components/MagicLinkWaiting'
import { authClient } from '@/lib/auth-client'
import './login.css'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

const loginSearchSchema = z.object({
	returnTo: z
		.string()
		.refine(
			(val) => {
				try {
					// Parse relative to a dummy origin; reject anything that resolves
					// to a different host (catches //, /\, and protocol-relative tricks).
					return new URL(val, 'http://localhost').hostname === 'localhost'
				} catch {
					return false
				}
			},
			{ message: 'returnTo must be a relative path' }
		)
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
	const router = useRouter()
	const navigate = useNavigate()
	const search = useSearch({ from: '/login' })
	const returnTo = () => search().returnTo || '/listings/mine'
	const [email, setEmail] = createSignal('')
	const [isSubmitting, setIsSubmitting] = createSignal(false)
	const [error, setError] = createErrorSignal()
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
		const { error } = await authClient.signIn.magicLink({
			email: emailValue,
			callbackURL: returnTo(),
		})
		setIsSubmitting(false)

		if (error) {
			setError(error)
		} else {
			setEmailSent(true)
		}
	}

	return (
		<Layout title="Sign In - Pick My Fruit">
			<SiteHeader breadcrumbs={[{ label: 'Sign In' }]} />
			<main class="login-page">
				<div class="login-container">
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
								onVerified={async () => {
									await router.invalidate()
									navigate({ to: returnTo() })
								}}
							/>
						}
					>
						<div class="login-content">
							<h1>Sign in to Pick My Fruit</h1>
							<Show
								when={search().returnTo}
								fallback={<p>Enter your email and we'll send you a sign-in link.</p>}
							>
								<p>
									Sign in to continue to{' '}
									{returnTo() === '/listings/new'
										? 'list your fruit tree'
										: returnTo() === '/listings/mine'
											? 'your garden'
											: 'your destination'}
									.
								</p>
							</Show>

							<form class="login-form" onSubmit={handleSubmit}>
								<ErrorMessage error={error()} />

								<Input
									autocomplete="on"
									autofocus
									label="Email address"
									onChange={setEmail}
									placeholder="you@example.com"
									required
									value={email()}
									name="email"
								/>

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
