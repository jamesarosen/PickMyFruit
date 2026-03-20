import { createFileRoute, useNavigate } from '@tanstack/solid-router'
import { Show, createSignal } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import { authMiddleware } from '@/middleware/auth'
import {
	getMySubscriptionById,
	updateSubscription,
	deleteSubscription,
} from '@/api/notifications'
import SubscriptionForm from '@/components/SubscriptionForm'
import '@/routes/notifications/$id.edit.css'

export const Route = createFileRoute('/notifications/$id/edit')({
	loader: ({ params }) =>
		getMySubscriptionById({ data: { id: Number(params.id) } }),
	component: EditSubscriptionPage,
	server: {
		middleware: [authMiddleware],
	},
})

function EditSubscriptionPage() {
	const navigate = useNavigate()
	const subscription = Route.useLoaderData()
	const [confirmingDelete, setConfirmingDelete] = createSignal(false)

	async function handleSubmit(data: {
		locationName: string
		throttlePeriod: 'hourly' | 'daily' | 'weekly'
		centerH3: string
		resolution: number
		ringSize: number
		produceTypes?: string[]
	}) {
		await updateSubscription({ data: { id: subscription()!.id, ...data } })
		navigate({ to: '/notifications' })
	}

	async function handleDeleteConfirm() {
		await deleteSubscription({ data: { id: subscription()!.id } })
		navigate({ to: '/notifications' })
	}

	return (
		<Layout title="Edit Subscription - Pick My Fruit">
			<PageHeader
				breadcrumbs={[
					{ label: 'My Notifications', to: '/notifications' },
					{ label: 'Edit Subscription' },
				]}
			/>
			<main id="main-content" class="notification-edit">
				<h1>Edit Subscription</h1>
				<Show
					when={subscription()}
					fallback={
						<p>
							Subscription not found.{' '}
							<a href="/notifications">View your subscriptions</a>
						</p>
					}
				>
					{(sub) => (
						<>
							<SubscriptionForm
								initialValues={{
									locationName: sub().locationName,
									throttlePeriod: sub().throttlePeriod as 'hourly' | 'daily' | 'weekly',
									centerH3: sub().centerH3,
									resolution: sub().resolution,
									ringSize: sub().ringSize,
									produceTypes: sub().produceTypes
										? JSON.parse(sub().produceTypes!)
										: undefined,
								}}
								onSubmit={handleSubmit}
							/>
							<Show
								when={confirmingDelete()}
								fallback={
									<button
										type="button"
										class="notification-edit__delete"
										onClick={() => setConfirmingDelete(true)}
									>
										Delete subscription
									</button>
								}
							>
								<div class="notification-edit__delete-confirm">
									<p>
										Delete this subscription? You will stop receiving these notifications.
									</p>
									<button
										type="button"
										class="notification-edit__delete-confirm-yes"
										onClick={handleDeleteConfirm}
									>
										Yes, delete
									</button>
									<button
										type="button"
										class="notification-edit__delete-confirm-cancel"
										onClick={() => setConfirmingDelete(false)}
									>
										Cancel
									</button>
								</div>
							</Show>
						</>
					)}
				</Show>
			</main>
		</Layout>
	)
}
