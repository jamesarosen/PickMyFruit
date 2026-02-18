import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import SiteHeader from '@/components/SiteHeader'
import ListingForm from '@/components/ListingForm'
import { authMiddleware } from '@/middleware/auth'
import { getMyLastAddress } from '@/api/listings'
import '@/routes/listings/new.css'

export const Route = createFileRoute('/listings/new')({
	loader: () => getMyLastAddress(),
	component: NewListingPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NewListingPage() {
	const lastAddress = Route.useLoaderData()

	return (
		<Layout title="List My Fruit Tree - Pick My Fruit">
			<SiteHeader
				breadcrumbs={[
					{ label: 'My Garden', to: '/listings/mine' },
					{ label: 'New Listing' },
				]}
			/>
			<main class="page-container">
				<header class="page-header">
					<h1>List Your Fruit Tree</h1>
					<p>Share your surplus with the community. Takes about 30 seconds.</p>
				</header>
				<ListingForm defaultAddress={lastAddress()} />
			</main>
		</Layout>
	)
}
