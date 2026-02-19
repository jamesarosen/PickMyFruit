import { createSignal, Show, type JSX } from 'solid-js'
import '@/components/Banner.css'

type BannerVariant = 'success' | 'error' | 'warning'

interface BannerProps {
	variant: BannerVariant
	children: JSX.Element
	dismissible?: boolean
}

/** Inline status banner with semantic color variants. */
export default function Banner(props: BannerProps) {
	const [dismissed, setDismissed] = createSignal(false)

	return (
		<Show when={!dismissed()}>
			<div class={`banner banner-${props.variant}`} role="status">
				<div class="banner-content">{props.children}</div>
				<Show when={props.dismissible}>
					<button
						type="button"
						class="banner-dismiss"
						aria-label="Dismiss"
						onClick={() => setDismissed(true)}
					>
						Dismiss
					</button>
				</Show>
			</div>
		</Show>
	)
}
