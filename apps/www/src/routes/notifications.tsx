import { createFileRoute } from '@tanstack/solid-router'
import { Switch as KSwitch } from '@kobalte/core/switch'
import { createSignal, For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'
import { authMiddleware } from '@/middleware/auth'
import {
	getNotifications,
	updateNotificationSubscription,
	type NotificationTopic,
} from '@/api/notifications'
import { Sentry } from '@/lib/sentry'
import '@/routes/notifications.css'

export const Route = createFileRoute('/notifications')({
	loader: () => getNotifications(),
	pendingComponent: () => (
		<Layout title="Notifications - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Notifications' }]} />
			<main id="main-content" class="notifications-page">
				<p>Loading…</p>
			</main>
		</Layout>
	),
	component: NotificationsPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NotificationsPage() {
	const data = Route.useLoaderData()

	return (
		<Layout title="Notifications - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Notifications' }]} />
			<main id="main-content" class="notifications-page">
				<h1>Manage Notifications</h1>
				<Show
					when={data().available}
					fallback={
						<p class="notifications-page__unavailable">
							Email notifications are not configured for this environment.
						</p>
					}
				>
					<Show
						when={data().topics.length > 0}
						fallback={
							<p class="notifications-page__empty">
								There are no notification topics to manage right now.
							</p>
						}
					>
						<form class="notifications-form">
							<For each={data().topics}>
								{(topic) => <TopicSwitch topic={topic} />}
							</For>
						</form>
					</Show>
				</Show>
			</main>
		</Layout>
	)
}

function TopicSwitch(props: { topic: NotificationTopic }) {
	const [checked, setChecked] = createSignal(props.topic.subscribed)
	const [pending, setPending] = createSignal(false)
	const [error, setError] = createErrorSignal()

	async function handleChange(next: boolean) {
		const previous = checked()
		setChecked(next)
		setPending(true)
		setError(null)
		try {
			await updateNotificationSubscription({
				data: { topicId: props.topic.id, subscribed: next },
			})
		} catch (err) {
			setChecked(previous)
			Sentry.captureException(err)
			setError(
				err instanceof Error
					? err.message
					: 'Could not update this notification preference.'
			)
		} finally {
			setPending(false)
		}
	}

	return (
		<KSwitch
			class="notification-topic"
			checked={checked()}
			onChange={handleChange}
			disabled={pending()}
		>
			<div class="notification-topic__row">
				<KSwitch.Label class="notification-topic__label">
					{props.topic.name}
				</KSwitch.Label>
				<KSwitch.Input class="notification-topic__input" />
				<KSwitch.Control class="notification-topic__control">
					<KSwitch.Thumb class="notification-topic__thumb" />
				</KSwitch.Control>
			</div>
			<Show when={props.topic.description}>
				{(description) => (
					<KSwitch.Description class="notification-topic__description">
						{description()}
					</KSwitch.Description>
				)}
			</Show>
			<ErrorMessage error={error()} />
		</KSwitch>
	)
}
