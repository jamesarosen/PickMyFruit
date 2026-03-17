import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import './privacy.css'
import { SupportEmail } from '@/components/SupportEmail'

export const Route = createFileRoute('/privacy')({
	component: PrivacyPage,
})

function PrivacyPage() {
	return (
		<Layout title="Privacy Policy - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Privacy Policy' }]} />
			<main id="main-content">
				<div class="container privacy-policy">
					<h1>Privacy Policy</h1>
					<p class="effective-date">Effective date: March 7, 2026</p>

					<p>
						Pick My Fruit ("we", "us", or "our") operates pickmyfruit.com. This policy
						explains what information we collect, how we use it, and what choices you
						have.
					</p>

					<section>
						<h2>What we collect</h2>
						<ul>
							<li>
								<strong>Email address</strong> — when you create an account or send a
								magic-link sign-in request.
							</li>
							<li>
								<strong>Produce listings</strong> — the type and quantity of produce you
								offer, plus the address you provide (see below).
							</li>
							<li>
								<strong>Messages</strong> — inquiries you send to or receive from other
								gardeners.
							</li>
							<li>
								<strong>Technical data</strong> — browser type, IP address, and error
								reports collected automatically to keep the site running reliably.
							</li>
						</ul>
						<p>We do not collect payment information or run advertising.</p>
					</section>

					<section>
						<h2>Location data</h2>
						<p>
							When you create a listing, you provide an exact address.
							<strong>
								We display only the approximate location publicly — never your exact
								address.
							</strong>
						</p>
						<p>
							Your precise address is shared with another user only if you explicitly
							choose to share it — for example, when you agree to a pick-up and decide
							to reveal your door-step location. We will always ask for your permission
							before disclosing anything more specific than your approximate area.
						</p>
					</section>

					<section>
						<h2>How we use your information</h2>
						<ul>
							<li>Match gardeners with surplus produce to people who want it.</li>
							<li>
								Send transactional emails (magic-link sign-ins, inquiry notifications)
								via Resend.
							</li>
							<li>
								Detect and fix bugs using Sentry error monitoring, which may capture
								limited contextual data when errors occur.
							</li>
							<li>Understand how the site is used so we can improve it.</li>
						</ul>
						<p>We do not sell or rent your information to third parties.</p>
					</section>

					<section>
						<h2>Who we share information with</h2>
						<p>
							We use a small number of trusted services to operate the site. Each
							receives only the minimum data needed for their function:
						</p>
						<ul>
							<li>
								<strong>
									<a href="https://resend.com/privacy">Resend</a>
								</strong>{' '}
								— email delivery (your email address and message content for
								transactional emails).
							</li>
							<li>
								<strong>
									<a href="https://sentry.io/privacy/">Sentry</a>
								</strong>{' '}
								— error monitoring (technical context when an error occurs; we configure
								Sentry to minimize personal data capture).
							</li>
							<li>
								<strong>
									<a href="https://fly.io/legal/privacy-policy">Fly.io</a>
								</strong>{' '}
								— hosting and infrastructure (your data is stored in a SQLite database
								on Fly.io servers in the United States).
							</li>
						</ul>
						<p>
							We do not share your information with any other parties unless required
							by law.
						</p>
					</section>

					<section>
						<h2>Data retention</h2>
						<p>
							We keep your account data for as long as your account is active. Listings
							and messages are retained to support ongoing exchanges. If you delete
							your account, we will remove your personal information within 30 days,
							except where retention is required by law.
						</p>
					</section>

					<section>
						<h2>Your rights</h2>
						<p>You can:</p>
						<ul>
							<li>Request a copy of the data we hold about you.</li>
							<li>Ask us to correct inaccurate information.</li>
							<li>Ask us to delete your account and personal data.</li>
						</ul>
						<p>
							To exercise any of these rights, email us at <SupportEmail />.
						</p>
						<p>
							<strong>California residents (CCPA):</strong> We do not sell your
							personal information. You have the right to know what data we collect and
							to request its deletion.
						</p>
					</section>

					<section>
						<h2>Cookies and local storage</h2>
						<p>
							We use a session cookie to keep you signed in. We do not use tracking or
							advertising cookies.
						</p>
					</section>

					<section>
						<h2>Children's privacy</h2>
						<p>
							Pick My Fruit is not directed at children under 13. We do not knowingly
							collect personal information from children.
						</p>
					</section>

					<section>
						<h2>Changes to this policy</h2>
						<p>
							We may update this policy from time to time. When we do, we will update
							the effective date at the top of the page. Continued use of the site
							after changes constitutes acceptance of the updated policy.
						</p>
					</section>

					<section>
						<h2>Contact</h2>
						<p>
							Questions or concerns? Email <SupportEmail />.
						</p>
					</section>
				</div>
			</main>
		</Layout>
	)
}
