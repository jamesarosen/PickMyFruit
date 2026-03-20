import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { authMiddleware } from '@/middleware/auth'
import { getMySubscriptions } from '@/api/notifications'
import type { NotificationSubscription } from '@/data/schema'
import { MAX_SUBSCRIPTIONS_PER_USER } from '@/lib/validation'
import { produceTypes } from '@/lib/produce-types'
import { ringDistanceLabel } from '@/lib/subscription-labels'
import '@/routes/notifications/index.css'

export const Route = createFileRoute('/notifications/')({
	loader: () => getMySubscriptions(),
	component: NotificationsIndexPage,
	server: {
		middleware: [authMiddleware],
	},
})

function SubscriptionCard(props: { subscription: NotificationSubscription }) {
	const throttleLabel = () => {
		const labels: Record<string, string> = {
			hourly: 'Hourly',
			daily: 'Daily',
			weekly: 'Weekly',
		}
		return (
			labels[props.subscription.throttlePeriod] ??
			props.subscription.throttlePeriod
		)
	}

	const produceLabel = () => {
		const raw = props.subscription.produceTypes
		if (!raw) return 'All produce'
		const slugs: string[] = JSON.parse(raw)
		if (slugs.length === 0) return 'All produce'
		const names = slugs
			.slice(0, 3)
			.map((s) => produceTypes.find((t) => t.slug === s)?.commonName ?? s)
		return slugs.length > 3 ? `${names.join(', ')} …` : names.join(', ')
	}

	return (
		<article class="subscription-card surface-subtle">
			<div class="subscription-card__details">
				<p class="subscription-card__produce">{produceLabel()}</p>
				<p class="subscription-card__meta">
					{throttleLabel()} · {ringDistanceLabel(props.subscription.ringSize)} around{' '}
					<span class="subscription-card__location">
						{props.subscription.locationName}
					</span>
				</p>
			</div>
			<Link
				to="/notifications/$id/edit"
				params={{ id: String(props.subscription.id) }}
				class="subscription-card__edit"
			>
				Edit
			</Link>
		</article>
	)
}

function NotificationsIndexPage() {
	const subscriptions = Route.useLoaderData()
	const atLimit = () =>
		(subscriptions() ?? []).length >= MAX_SUBSCRIPTIONS_PER_USER

	return (
		<Layout title="My Notifications - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'My Notifications' }]} />
			<main id="main-content" class="notifications-index">
				<header class="notifications-index__header">
					<h1>My Notifications</h1>
				</header>

				<Show
					when={(subscriptions() ?? []).length > 0}
					fallback={
						<div class="notifications-index__empty">
							<p>No subscriptions yet.</p>
							<Link to="/notifications/new">Add a subscription</Link>
						</div>
					}
				>
					<div class="notifications-index__list">
						<For each={subscriptions()}>
							{(sub) => <SubscriptionCard subscription={sub} />}
						</For>
					</div>
					<Link
						to="/notifications/new"
						class="notifications-index__add-button"
						aria-disabled={atLimit() ? 'true' : undefined}
					>
						Add a subscription
					</Link>
					<Show when={atLimit()}>
						<p class="notifications-index__limit-notice">
							You've reached the {MAX_SUBSCRIPTIONS_PER_USER}-subscription limit.
							Delete one to add another.
						</p>
					</Show>
				</Show>
			</main>
		</Layout>
	)
}
