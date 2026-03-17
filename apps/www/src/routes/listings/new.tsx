import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingForm from '@/components/ListingForm'
import { getMyLastAddress } from '@/api/listings'
import '@/routes/listings/new.css'
import '@/components/ListingForm.css'

export const Route = createFileRoute('/listings/new')({
	loader: async () => {
		try {
			return await getMyLastAddress()
		} catch {
			// errorMiddleware on getMyLastAddress already sent the original exception
			// to Sentry and re-threw it as a UserError. No need to re-capture here.
			return undefined
		}
	},
	component: NewListingPage,
})

function NewListingPage() {
	const lastAddress = Route.useLoaderData()

	return (
		<Layout title="List My Fruit Tree - Pick My Fruit">
			<PageHeader
				breadcrumbs={[
					{ label: 'My Garden', to: '/listings/mine' },
					{ label: 'New Listing' },
				]}
			/>
			<main id="main-content" class="listing-new">
				<header class="new-listing-header">
					<h1>List Your Fruit Tree</h1>
					<p>Share your surplus with the community. Takes about 30 seconds.</p>
				</header>
				<ListingForm defaultAddress={lastAddress()} />
			</main>
		</Layout>
	)
}
