import { createSignal, Show, type JSX } from 'solid-js'

type BannerVariant = 'success' | 'error' | 'warning'

interface BannerProps {
	variant: BannerVariant
	children: JSX.Element
	dismissible?: boolean
}

const VARIANT_CLASS: Record<BannerVariant, string> = {
	success: 'notice--success',
	error: 'notice--error',
	warning: 'notice--warning',
}

/**
 * Inline dismissible banner. Uses the `.notice` primitive in `--bar` layout so
 * that visual tone is shared with block-level notices.
 */
export default function Banner(props: BannerProps) {
	const [dismissed, setDismissed] = createSignal(false)

	return (
		<Show when={!dismissed()}>
			<div
				class={`notice notice--bar ${VARIANT_CLASS[props.variant]}`}
				role="status"
			>
				<div>{props.children}</div>
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
