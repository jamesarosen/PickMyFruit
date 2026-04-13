import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { getMySubscriptions } from '@/api/notifications'
import { authMiddleware } from '@/middleware/auth'
import {
	RING_SIZE_LABELS,
	THROTTLE_PERIOD_LABELS,
} from '@/lib/subscription-labels'
import type { NotificationSubscription } from '@/data/schema'
import '@/routes/notifications/index.css'

interface SubscriptionListItem {
	label: string
	placeName: string
	ringLabel: string
	throttleLabel: string
}

function toSubscriptionListItem(
	subscription: NotificationSubscription
): SubscriptionListItem {
	const ringLabel =
		RING_SIZE_LABELS[subscription.ringSize] ?? `~${subscription.ringSize} ring`
	const throttleLabel =
		THROTTLE_PERIOD_LABELS[subscription.throttlePeriod] ??
		subscription.throttlePeriod

	return {
		label: subscription.label?.trim() || subscription.placeName,
		placeName: subscription.placeName,
		ringLabel,
		throttleLabel,
	}
}

export const Route = createFileRoute('/notifications/')({
	loader: async () => {
		const subscriptions = await getMySubscriptions()
		return subscriptions.map(toSubscriptionListItem)
	},
	component: NotificationsPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NotificationsPage() {
	const subscriptions = Route.useLoaderData()

	return (
		<Layout title="Notifications - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Notifications' }]} />
			<main id="main-content" class="notifications-page">
				<header class="notifications-page__header">
					<h1>Notifications</h1>
					<Link to="/notifications/new" class="notifications-page__add-link">
						Add a subscription
					</Link>
				</header>

				<Show
					when={subscriptions().length > 0}
					fallback={
						<p class="notifications-page__empty">
							No subscriptions yet. Create one to get notified when new produce is
							posted near you.
						</p>
					}
				>
					<ul class="notifications-page__list">
						<For each={subscriptions()}>
							{(subscription) => (
								<li class="notifications-page__item">
									<h2>{subscription.label}</h2>
									<p>{subscription.placeName}</p>
									<p>{`Searching within ${subscription.ringLabel}`}</p>
									<p>{`Delivery: ${subscription.throttleLabel}`}</p>
								</li>
							)}
						</For>
					</ul>
				</Show>
			</main>
		</Layout>
	)
}
