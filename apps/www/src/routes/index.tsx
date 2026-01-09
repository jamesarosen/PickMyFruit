import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import Layout from '@/components/Layout'
import { getAvailablePlants } from '@/api/plants'
import '@/routes/index.css'

export const Route = createFileRoute('/')({
	loader: () => getAvailablePlants({ data: 3 }),
	component: HomePage,
})

function HomePage() {
	const plants = Route.useLoaderData()

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
				<section class="hero surface-subtle">
					<div class="container">
						<h1>Stop Watching Your Fruit Rot</h1>
						<p class="hero-subtitle">
							Turn your backyard abundance into community food. We connect you with
							local gleaners. Serving all of Napa.
						</p>
						<Link to="/garden/new" class="cta-button">
							List My Fruit Tree
						</Link>
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
						<Link to="/garden/new" class="cta-button">
							List My Fruit Tree
						</Link>
					</div>
				</section>

				<section class="available-plants">
					<div class="container">
						<h2>Available Now in Napa</h2>
						<Show
							when={plants().length > 0}
							fallback={<p>No plants available right now.</p>}
						>
							<div class="plants-grid">
								<For each={plants()}>
									{(plant) => (
										<div class="plant-card surface-subtle">
											<h3>{plant.name}</h3>
											<p class="plant-variety">
												{plant.type} - {plant.variety}
											</p>
											<p class="plant-quantity">Quantity: {plant.quantity}</p>
											<p class="plant-harvest">Harvest: {plant.harvestWindow}</p>
											<p class="plant-location">
												{plant.city}, {plant.state}
											</p>
											{plant.notes && <p class="plant-notes">{plant.notes}</p>}
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>
				</section>

				<section class="contact-info surface-subtle">
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
							Built by <span>Your Name</span>
						</span>
					</div>
					<nav class="footer-nav">
						<button type="button">About</button>
						<button type="button">Contact</button>
						<button type="button">Privacy</button>
					</nav>
				</div>
			</footer>
		</Layout>
	)
}
