/**
 * Mirrors `window.visualViewport` metrics onto CSS custom properties so
 * overlays can align with the on-screen region (above the mobile keyboard),
 * not the layout viewport.
 *
 * On iOS Safari a `position: fixed` element is anchored to the layout
 * viewport, which still spans behind the keyboard and the autofill bar when
 * they appear. As a result, popovers positioned at `bottom: 0` end up hidden
 * below the keyboard and also jitter as the visual viewport shifts while the
 * user scrolls. Reading `visualViewport.offsetTop` and `.height` lets us
 * offset overlays to stay inside the currently-visible region.
 */

/** Disposer returned from {@link trackVisualViewport}. */
export type VisualViewportDisposer = () => void

/** CSS variable holding the distance between the visual viewport's bottom edge and the layout viewport's bottom edge (in `px`). */
export const VISUAL_VIEWPORT_BOTTOM_INSET_VAR = '--visual-viewport-bottom-inset'
/** CSS variable holding the visual viewport's height (in `px`). */
export const VISUAL_VIEWPORT_HEIGHT_VAR = '--visual-viewport-height'

/**
 * Starts writing `--visual-viewport-bottom-inset` and
 * `--visual-viewport-height` to the given element, updating them as the
 * visual viewport resizes or scrolls. Returns a disposer that removes the
 * listeners and clears the variables.
 *
 * Safe to call when `window.visualViewport` is unsupported; in that case the
 * function reads `window.innerHeight` once and attaches no listeners.
 */
export function trackVisualViewport(
	target: HTMLElement = document.documentElement
): VisualViewportDisposer {
	const vv = window.visualViewport

	const update = () => {
		const height = vv?.height ?? window.innerHeight
		const offsetTop = vv?.offsetTop ?? 0
		const layoutHeight = window.innerHeight
		// Distance from bottom of visual viewport to bottom of layout viewport.
		// When the keyboard is open on iOS, this is roughly the keyboard height.
		const bottomInset = Math.max(0, layoutHeight - height - offsetTop)
		target.style.setProperty(VISUAL_VIEWPORT_BOTTOM_INSET_VAR, `${bottomInset}px`)
		target.style.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${height}px`)
	}

	update()

	if (!vv) {
		return () => {
			target.style.removeProperty(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)
			target.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR)
		}
	}

	vv.addEventListener('resize', update)
	vv.addEventListener('scroll', update)

	return () => {
		vv.removeEventListener('resize', update)
		vv.removeEventListener('scroll', update)
		target.style.removeProperty(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)
		target.style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR)
	}
}
