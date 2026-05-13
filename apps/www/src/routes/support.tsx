import { createFileRoute, useSearch } from '@tanstack/solid-router'
import { z } from 'zod'
import { createServerFn } from '@tanstack/solid-start'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import jamesGarden from '@/assets/james-garden.jpeg'
import './support.css'

const searchSchema = z.object({
	from: z.string().optional(),
})

const recordSupportView = createServerFn({ method: 'GET' })
	.inputValidator((input: unknown) => searchSchema.parse(input))
	.handler(async ({ data }) => {
		const { Sentry } = await import('@/lib/sentry')
		Sentry.metrics.count('support.view', 1, {
			attributes: { from: data.from ?? 'direct' },
		})
		return null
	})

export const Route = createFileRoute('/support')({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ from: search.from }),
	loader: async ({ deps }) => {
		await recordSupportView({ data: { from: deps.from } })
	},
	component: SupportPage,
})

function SupportPage() {
	const search = useSearch({ from: '/support' })
	const goHref = () => {
		const from = search().from
		return from ? `/support/go?from=${encodeURIComponent(from)}` : '/support/go'
	}

	return (
		<Layout title="Support Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Support' }]} />
			<main id="main-content" class="support-page">
				<div class="container">
					<header class="support-page__intro">
						<h1>Keep Pick My Fruit Running</h1>
						<p class="support-page__subhead">
							An honest ask from one person to another.
						</p>
					</header>

					<section>
						<img
							src={jamesGarden}
							alt="James, smiling in his garden next to artichokes and figs"
							class="support-page__portrait"
							width="200"
							height="200"
						/>
						<p>
							Hi, I'm James. I built Pick My Fruit because watching fruit rot while
							people go hungry felt like a problem I could chip away at. I'm one person
							working on this in my spare time. Your support keeps this running and
							lets it outlast me.
						</p>
					</section>

					<section>
						<h2>What support funds</h2>
						<ul>
							<li>
								Hosting and infrastructure:
								<a href="https://fly.io/" rel="noopener">
									Fly.io
								</a>
								,{' '}
								<a href="https://www.tigrisdata.com/" rel="noopener">
									Tigris
								</a>
								,{' '}
								<a href="https://dnsimple.com/" rel="noopener">
									dnsimple
								</a>
								,{' '}
								<a href="https://resend.com/" rel="noopener">
									Resend
								</a>{' '}
								,{' '}
								<a href="https://sentry.io/" rel="noopener">
									Sentry
								</a>
								— $10/month
							</li>
							<li>
								Development tooling:{' '}
								<a href="https://github.com/" rel="noopener">
									GitHub
								</a>
								,{' '}
								<a href="https://claude.ai/" rel="noopener">
									Claude
								</a>{' '}
								— $25/month
							</li>
							<li>
								California benefit corporation filing and annual franchise tax —
								$800/year
							</li>
						</ul>
					</section>

					<section>
						<h2>Disclosure</h2>
						<p>
							This isn't tax-deductible. Pick My Fruit isn't a nonprofit — it's a
							personal project on the way to becoming a California benefit corporation.
							One day we may become a{' '}
							<a href="https://www.bcorporation.net/" rel="noopener">
								Certified B Corporation
							</a>
							. Your support goes directly to keeping the project alive, rescuing
							produce, and feeding people.
						</p>
					</section>

					<section class="support-page__cta">
						<p>
							Suggested amounts: $5/month covers hosting the site. $25/month covers our
							development tooling. Or chip in once, any amount.
						</p>
						<a
							href={goHref()}
							class="button button--primary button--lg"
							target="_blank"
							rel="noopener noreferrer"
						>
							Support on Buy Me a Coffee →
						</a>
					</section>

					<section>
						<h2>Other ways to help</h2>
						<p>
							Not in a position to chip in? You can still help: list some produce from
							your garden, tell a neighbor, share on NextDoor or a local Facebook
							group, or <a href="mailto:james@pickmyfruit.com">email me</a> what you'd
							want this to do next.
						</p>
					</section>
				</div>
			</main>
		</Layout>
	)
}
