import type { ComponentProps } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import ArrowRightLeft from 'lucide-solid/icons/arrow-right-left'
import ArrowRightFromLine from 'lucide-solid/icons/arrow-right-from-line'
import '@/components/DropOffIndicator.css'

/**
 * Indicates whether a produce stand accepts drop-offs. The layout adapts to the
 * width of its slot via a CSS container query: a narrow slot shows only the
 * icon (the label rides along as `title` / `alt`), a wide slot shows the icon
 * beside the label. Pass `class` to size the slot (e.g. a narrow chip).
 */
export default function DropOffIndicator(props: {
	acceptsDropOffs: boolean
	class?: string
}) {
	const label = () =>
		props.acceptsDropOffs ? 'Accepts drop-offs' : 'Does not accept drop-offs'
	const icon = () =>
		props.acceptsDropOffs ? ArrowRightLeft : ArrowRightFromLine

	// `alt` isn't a typed SVG prop, but the spec asks for it on the icon-only
	// (narrow) layout; cast so it lands as an attribute alongside the
	// title/aria-label that do the real a11y work.
	const iconProps = (): ComponentProps<typeof ArrowRightLeft> =>
		({
			class: 'drop-off-indicator__icon',
			size: '1.125em',
			'aria-hidden': 'true',
			alt: label(),
		}) as unknown as ComponentProps<typeof ArrowRightLeft>

	return (
		<span
			class="drop-off-indicator"
			classList={{
				'drop-off-indicator--accepts': props.acceptsDropOffs,
				'drop-off-indicator--declines': !props.acceptsDropOffs,
				[props.class ?? '']: Boolean(props.class),
			}}
			role="img"
			aria-label={label()}
			title={label()}
		>
			<Dynamic component={icon()} {...iconProps()} />
			<span class="drop-off-indicator__text">{label()}</span>
		</span>
	)
}
