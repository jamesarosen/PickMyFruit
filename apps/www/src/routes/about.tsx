import { createFileRoute, Link } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import './about.css'
import { SupportEmail } from '@/components/SupportEmail'

export const Route = createFileRoute('/about')({
	component: AboutPage,
})

function AboutPage() {
	return (
		<Layout title="About - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'About' }]} />
			<main id="main-content" class="about-page">
				<div class="container">
					<h1>About Pick My Fruit</h1>

					<blockquote class="motto">
						Blessed are those who plant trees under which they will never sit.
					</blockquote>

					<section>
						<h2>The Problem</h2>
						<p>
							Food waste exists alongside hunger because of broken connections, not
							scarcity. Every season, fruit falls to the ground while families go
							without. Pick My Fruit reconnects that abundance to need.
						</p>
					</section>

					<section>
						<h2>Who It's For</h2>
						<ul>
							<li>
								<strong>Growers</strong> — You have a lemon tree loaded with more fruit
								than you can use. We find someone who wants it.
							</li>
							<li>
								<strong>Gleaners</strong> — You're looking for fresh, local produce. We
								show you what's available nearby.
							</li>
							<li>
								<strong>Gleaning groups</strong> — You organize regular harvests for
								food banks and community organizations. We help you find trees and
								coordinate pickups.
							</li>
						</ul>
					</section>

					<section>
						<h2>Where We Operate</h2>
						<p>
							We're currently serving Napa and surrounding areas, with plans to expand
							to more communities.
						</p>
					</section>

					<section>
						<h2>Our Mission</h2>
						<p>Rescue the most food. Feed the most people.</p>
						<p>
							We think in decades, not quarters. Every fruit tree, every volunteer
							connection, every process we build should leave things better than we
							found them.
						</p>
					</section>

					<section class="about-ctas">
						<Link to="/listings/new" class="button button--primary button--lg">
							List My Fruit Tree
						</Link>
						<p class="contact-cta">
							Questions or ideas? Email us: <SupportEmail class="text-accent" />.
						</p>
					</section>
				</div>
			</main>
		</Layout>
	)
}
