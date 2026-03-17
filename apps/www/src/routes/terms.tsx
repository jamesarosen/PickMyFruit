import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import './terms.css'
import { SupportEmail } from '@/components/SupportEmail'

export const Route = createFileRoute('/terms')({
	component: TermsPage,
})

function TermsPage() {
	return (
		<Layout title="Terms of Service - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Terms of Service' }]} />
			<main id="main-content">
				<div class="container terms-of-service">
					<h1>Terms of Service</h1>
					<p class="effective-date">Effective date: March 8, 2026</p>

					<p>
						Welcome to Pick My Fruit ("we", "us", or "our"). By using pickmyfruit.com
						(the "Site"), you agree to these Terms of Service. If you do not agree,
						please do not use the Site.
					</p>

					<section>
						<h2>What Pick My Fruit is</h2>
						<p>
							Pick My Fruit is a platform that connects gardeners who have surplus
							produce with community members who would like it. We facilitate
							introductions — we do not grow, handle, inspect, or deliver any produce.
						</p>
					</section>

					<section>
						<h2>No warranty on produce quality or safety</h2>
						<p>
							<strong>
								We make no representations or warranties, express or implied, about the
								quality, safety, fitness for consumption, or condition of any produce
								listed on the Site.
							</strong>{' '}
							All produce is shared between private individuals. We do not inspect,
							test, certify, or verify any produce offered through the Site.
						</p>
						<p>
							You are solely responsible for evaluating whether any produce you receive
							is safe and suitable for your intended use. When in doubt, discard it.
							Pick My Fruit is not liable for any illness, injury, loss, or damage
							arising from consuming or using produce obtained through the Site.
						</p>
					</section>

					<section>
						<h2>Harvesting safety</h2>
						<p>
							<strong>
								Harvesting produce — climbing trees, using ladders, working on
								unfamiliar property, and handling tools — carries inherent physical
								risks. You assume all risk associated with the harvesting process.
							</strong>
						</p>
						<p>
							Pick My Fruit is not liable for any injury, accident, property damage, or
							other harm that occurs during or in connection with harvesting activities
							arranged through the Site. Neither the property owner's listing nor our
							platform constitutes an assurance that any property is safe for entry,
							harvesting, or any other activity.
						</p>
						<p>
							Before entering someone's property or beginning to harvest, take
							reasonable precautions: assess the site, use appropriate equipment, and
							do not proceed if conditions seem unsafe.
						</p>
					</section>

					<section>
						<h2>Acceptable use</h2>
						<p>You agree not to:</p>
						<ul>
							<li>Post false, misleading, or fraudulent listings.</li>
							<li>
								Use the Site for commercial resale of produce without the explicit
								permission of the listing gardener.
							</li>
							<li>
								Harass, threaten, or harm other users in any way, whether through the
								Site or during in-person exchanges.
							</li>
							<li>
								Attempt to gain unauthorized access to the Site or another user's
								account.
							</li>
							<li>
								Use automated tools to scrape, index, or interact with the Site without
								our written consent.
							</li>
						</ul>
					</section>

					<section>
						<h2>User accounts</h2>
						<p>
							You must provide a valid email address and keep your account information
							accurate. You are responsible for all activity that occurs under your
							account. Notify us immediately at <SupportEmail /> if you believe your
							account has been compromised.
						</p>
					</section>

					<section>
						<h2>Listings and content</h2>
						<p>
							You are responsible for the accuracy and legality of any content you
							post. By submitting a listing or message, you grant us a limited,
							non-exclusive license to display and transmit that content as necessary
							to operate the Site. We reserve the right to remove any content that
							violates these Terms or that we deem harmful to the community.
						</p>
					</section>

					<section>
						<h2>Disclaimer of warranties</h2>
						<p>
							The Site is provided "as is" and "as available" without warranty of any
							kind. To the fullest extent permitted by law, we disclaim all warranties,
							express or implied, including merchantability, fitness for a particular
							purpose, and non-infringement.
						</p>
					</section>

					<section>
						<h2>Limitation of liability</h2>
						<p>
							To the fullest extent permitted by applicable law, Pick My Fruit and its
							operators shall not be liable for any indirect, incidental, special,
							consequential, or punitive damages arising out of your use of (or
							inability to use) the Site or any produce or interactions facilitated
							through it, even if we have been advised of the possibility of such
							damages.
						</p>
						<p>
							Our total liability to you for any claim arising from these Terms or your
							use of the Site shall not exceed the amount you paid us in the twelve
							months preceding the claim (which, given that the Site is currently free,
							is zero).
						</p>
					</section>

					<section>
						<h2>Indemnification</h2>
						<p>
							You agree to indemnify and hold harmless Pick My Fruit and its operators
							from any claims, damages, or expenses (including reasonable attorneys'
							fees) arising from your use of the Site, your listings or messages, your
							harvesting activities, or your violation of these Terms.
						</p>
					</section>

					<section>
						<h2>Third-party interactions</h2>
						<p>
							Exchanges arranged through the Site take place between private
							individuals. We are not a party to those exchanges and have no control
							over the conduct of any user. Always exercise common sense and personal
							judgment when meeting strangers or entering unfamiliar properties.
						</p>
					</section>

					<section>
						<h2>Changes to these Terms</h2>
						<p>
							We may update these Terms from time to time. When we do, we will update
							the effective date at the top of this page. Continued use of the Site
							after changes constitutes acceptance of the updated Terms.
						</p>
					</section>

					<section>
						<h2>Governing law</h2>
						<p>
							These Terms are governed by the laws of the State of California, without
							regard to its conflict-of-law provisions. Any disputes shall be resolved
							in the courts of San Francisco County, California.
						</p>
					</section>

					<section>
						<h2>Contact</h2>
						<p>
							Questions about these Terms? Email <SupportEmail />.
						</p>
					</section>
				</div>
			</main>
		</Layout>
	)
}
