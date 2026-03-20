import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'

export const Route = createFileRoute('/notifications/unsubscribed')({
	component: UnsubscribedPage,
})

function UnsubscribedPage() {
	return (
		<Layout title="Unsubscribed - Pick My Fruit">
			<PageHeader
				breadcrumbs={[
					{ label: 'My Notifications', to: '/notifications' },
					{ label: 'Unsubscribed' },
				]}
			/>
			<main id="main-content" style={{ 'max-width': '600px', padding: '1.5rem' }}>
				<h1>You've been unsubscribed</h1>
				<p>You will no longer receive notifications for that subscription.</p>
				<p>
					<a href="/notifications">Manage your other subscriptions</a>
				</p>
			</main>
		</Layout>
	)
}
