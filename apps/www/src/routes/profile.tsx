import {
	createFileRoute,
	useRouter,
	useRouteContext,
} from '@tanstack/solid-router'
import { createSignal, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { Input } from '@/components/FormField'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'
import { authMiddleware } from '@/middleware/auth'
import { authClient } from '@/lib/auth-client'
import '@/routes/profile.css'

export const Route = createFileRoute('/profile')({
	component: ProfilePage,
	server: {
		middleware: [authMiddleware],
	},
})

function ProfilePage() {
	const router = useRouter()
	const context = useRouteContext({ from: '__root__' })
	const user = () => context().session?.user

	const [submitting, setSubmitting] = createSignal(false)
	const [saved, setSaved] = createSignal(false)
	const [submitError, setSubmitError] = createErrorSignal()

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault()
		if (submitting()) return

		const form = event.target as HTMLFormElement
		const name = (
			form.elements.namedItem('name') as HTMLInputElement
		).value.trim()

		setSubmitting(true)
		setSaved(false)
		setSubmitError(null)

		const { error } = await authClient.updateUser({ name })
		if (error) {
			setSubmitError(
				error instanceof Error ? error.message : 'Failed to update profile'
			)
			setSubmitting(false)
			return
		}

		// Refresh route data so the header and session reflect the new name.
		await router.invalidate()
		setSaved(true)
		setSubmitting(false)
	}

	return (
		<Layout title="Profile - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Profile' }]} />
			<main id="main-content" class="profile-page">
				<h1>Profile</h1>
				<form class="profile-form" onSubmit={handleSubmit}>
					<ErrorMessage class="form-message error" error={submitError()} />
					<Input disabled label="Email Address" value={user()?.email} />
					<Input
						label="Your name"
						name="name"
						defaultValue={user()?.name ?? ''}
						maxlength={100}
						required
					/>
					<div class="form-actions">
						<button
							type="submit"
							class="button button--primary"
							disabled={submitting()}
						>
							{submitting() ? 'Saving…' : 'Save'}
						</button>
						<Show when={saved()}>
							<p class="profile-success" role="status">
								Saved!
							</p>
						</Show>
					</div>
				</form>
			</main>
		</Layout>
	)
}
