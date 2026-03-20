import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { authMiddleware } from '@/middleware/auth'
import { createSubscription } from '@/api/notifications'
import SubscriptionForm from '@/components/SubscriptionForm'
import '@/routes/notifications/new.css'

export const Route = createFileRoute('/notifications/new')({
	component: NewSubscriptionPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NewSubscriptionPage() {
	const navigate = useNavigate()

	async function handleSubmit(data: {
		locationName: string
		throttlePeriod: 'hourly' | 'daily' | 'weekly'
		centerH3: string
		resolution: number
		ringSize: number
		produceTypes?: string[]
	}) {
		await createSubscription({ data })
		navigate({ to: '/notifications' })
	}

	return (
		<Layout title="New Subscription - Pick My Fruit">
			<PageHeader
				breadcrumbs={[
					{ label: 'My Notifications', to: '/notifications' },
					{ label: 'New Subscription' },
				]}
			/>
			<main id="main-content" class="notification-new">
				<h1>New Subscription</h1>
				<SubscriptionForm
					initialValues={{ resolution: 7, throttlePeriod: 'weekly' }}
					onSubmit={handleSubmit}
				/>
			</main>
		</Layout>
	)
}
