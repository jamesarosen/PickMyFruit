import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import SubscriptionForm from '@/components/SubscriptionForm'
import { authMiddleware } from '@/middleware/auth'
import '@/routes/notifications/new.css'

export const Route = createFileRoute('/notifications/new')({
	component: NewNotificationSubscriptionPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NewNotificationSubscriptionPage() {
	return (
		<Layout title="New Notification Subscription - Pick My Fruit">
			<PageHeader
				breadcrumbs={[
					{ label: 'Notifications', to: '/notifications' },
					{ label: 'New Subscription' },
				]}
			/>
			<main id="main-content" class="notifications-new">
				<header class="notifications-new__header">
					<h1>Create a notification subscription</h1>
					<p>Get notified when new produce listings are posted near you.</p>
				</header>
				<SubscriptionForm />
			</main>
		</Layout>
	)
}
