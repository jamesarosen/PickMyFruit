import { createFileRoute } from '@tanstack/solid-router'
import Layout from '@/components/Layout'
import { triggerE2eRootErrorBoundary } from '@/api/e2e-root-error'

export const Route = createFileRoute('/__e2e__/root-error')({
	loader: () => triggerE2eRootErrorBoundary(),
	component: E2eRootErrorProbe,
})

/** Never reached when the E2E server env flag triggers the loader error. */
function E2eRootErrorProbe() {
	return (
		<Layout title="E2E root error probe">
			<main id="main-content">
				<p>This page should not render during E2E.</p>
			</main>
		</Layout>
	)
}
