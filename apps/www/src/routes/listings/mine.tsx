import { createFileRoute, Link, useRouteContext } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import ListingCard from '@/components/ListingCard'
import { authMiddleware } from '@/middleware/auth'
import { getMyListings, getMyInquiries } from '@/api/listings'
import { displayName } from '@/lib/display-name'
import type { OwnerInquiry } from '@/data/queries.server'
import '@/routes/listings/mine.css'

export const Route = createFileRoute('/listings/mine')({
	loader: async () => {
		const [listings, inquiries] = await Promise.all([
			getMyListings(),
			getMyInquiries(),
		])
		return { listings, inquiries }
	},
	pendingComponent: () => (
		<Layout title="My Garden - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main id="main-content" class="listings-mine">
				<p>Loading…</p>
			</main>
		</Layout>
	),
	component: MyGardenPage,
	server: {
		middleware: [authMiddleware],
	},
})

function EmptyState() {
	return (
		<div class="empty-state">
			<h2>No listings yet</h2>
			<p>Share something from your garden with the community!</p>
			<Link to="/listings/new" class="button button--primary">
				Add a Listing
			</Link>
		</div>
	)
}

// Fixed locale so SSR and client hydration render identical text.
const inquiryDateFormat = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
})

function InquiryItem(props: { inquiry: OwnerInquiry }) {
	const gleaner = () =>
		displayName({
			name: props.inquiry.gleanerName,
			email: props.inquiry.gleanerEmail,
		})
	const replyHref = () =>
		`mailto:${props.inquiry.gleanerEmail}?subject=${encodeURIComponent(
			`Re: your inquiry about ${props.inquiry.listingName}`
		)}`

	return (
		<li class="inquiry-item">
			<p class="inquiry-summary">
				<strong>{gleaner()}</strong>
				{' asked about '}
				<Link to="/listings/$id" params={{ id: String(props.inquiry.listingId) }}>
					{props.inquiry.listingName}
				</Link>{' '}
				<time datetime={props.inquiry.createdAt.toISOString()}>
					{inquiryDateFormat.format(props.inquiry.createdAt)}
				</time>
			</p>
			<Show when={props.inquiry.note}>
				<blockquote class="inquiry-note">{props.inquiry.note}</blockquote>
			</Show>
			<a class="button button--secondary inquiry-reply" href={replyHref()}>
				Reply to {gleaner()}
			</a>
		</li>
	)
}

function MyGardenPage() {
	const data = Route.useLoaderData()
	const context = useRouteContext({ from: '__root__' })

	return (
		<Layout title="My Garden - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'My Garden' }]} />
			<main id="main-content" class="listings-mine">
				<header class="my-garden-header">
					<h1>My Garden</h1>
					<Show when={context().session?.user}>
						{(user) => <p>Welcome back, {displayName(user())}!</p>}
					</Show>
				</header>

				<Show when={(data().listings ?? []).length > 0} fallback={<EmptyState />}>
					<div class="listings-grid">
						<For each={data().listings}>
							{(listing) => <ListingCard listing={listing} />}
						</For>
					</div>

					<div class="page-actions">
						<Link to="/listings/new" class="button button--primary">
							Add Another Tree
						</Link>
					</div>

					<section class="inquiries-section" aria-labelledby="inquiries-heading">
						<h2 id="inquiries-heading">Inquiries</h2>
						<Show
							when={data().inquiries.length > 0}
							fallback={
								<p class="inquiries-empty">
									No inquiries yet. When a gleaner asks about one of your listings, it
									will show up here.
								</p>
							}
						>
							<ul class="inquiry-list">
								<For each={data().inquiries}>
									{(inquiry) => <InquiryItem inquiry={inquiry} />}
								</For>
							</ul>
						</Show>
					</section>
				</Show>
			</main>
		</Layout>
	)
}
