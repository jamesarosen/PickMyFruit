import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import ListingForm from '@/components/ListingForm'
import { authMiddleware } from '@/middleware/auth'
import '@/routes/garden/new.css'

export const Route = createFileRoute('/garden/new')({
	component: NewListingPage,
	server: {
		middleware: [authMiddleware],
	},
})

function NewListingPage() {
	return (
		<Layout title="List My Fruit Tree - Pick My Fruit">
			<main class="page-container">
				<header class="page-header">
					<h1>List Your Fruit Tree</h1>
					<p>Share your surplus with the community. Takes about 30 seconds.</p>
				</header>
				<ListingForm />
			</main>
		</Layout>
	)
}
