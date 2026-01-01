import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import '@/routes/index.css'

export const Route = createFileRoute('/')({
	component: HomePage,
})

function HomePage() {
	return (
		<Layout title="Pick My Fruit - Turn your backyard abundance into community food">
			<header>
				<div class="container">
					<div class="logo">
						<span class="logo-icon">🍑</span>
						<span class="logo-text">Pick My Fruit</span>
					</div>
				</div>
			</header>

			<main>
				<section class="hero">
					<div class="container">
						<h1>Stop Watching Your Fruit Rot</h1>
						<p class="hero-subtitle">
							Turn your backyard abundance into community food. We connect you
							with local gleaners. Serving all of Napa.
						</p>
						<a href="#" class="cta-button">
							List My Fruit Tree
						</a>
					</div>
				</section>

				<section class="how-it-works">
					<div class="container">
						<h2>How It Works</h2>
						<div class="steps">
							<div class="step">
								<div class="step-number">1</div>
								<h3>Tell us about your tree</h3>
								<p>Takes 30 seconds</p>
							</div>
							<div class="step">
								<div class="step-number">2</div>
								<h3>We find a local gleaner</h3>
								<p>You get notified</p>
							</div>
							<div class="step">
								<div class="step-number">3</div>
								<h3>They pick, you relax</h3>
								<p>Surplus feeds families</p>
							</div>
						</div>
						<a href="#" class="cta-button">
							List My Fruit Tree
						</a>
					</div>
				</section>

				<section class="contact-info">
					<div class="container">
						<p>
							Questions? Text me at <a href="tel:+15551234567">(555) 123-4567</a>
						</p>
					</div>
				</section>
			</main>

			<footer>
				<div class="container">
					<div class="footer-left">
						<span class="footer-avatar">JD</span>
						<span>
							Built by <a href="#">Your Name</a>
						</span>
					</div>
					<nav class="footer-nav">
						<a href="#">About</a>
						<a href="#">Contact</a>
						<a href="#">Privacy</a>
					</nav>
				</div>
			</footer>
		</Layout>
	)
}
