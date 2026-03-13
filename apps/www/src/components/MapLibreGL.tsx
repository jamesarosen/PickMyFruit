import { Sentry } from '@/lib/sentry'
import { clsx } from 'clsx'
import {
	createSignal,
	type JSX,
	onMount,
	onCleanup,
	splitProps,
} from 'solid-js'
import './MapLibreGL.css'

/**
 * Arguments passed to the caller when the loader is ready.
 */
export interface MapLibreGLReadyArgs {
	container: HTMLDivElement
	maplibregl: typeof import('maplibre-gl')
}

/**
 * Props exposed by the loader component.  All remaining props are
 * forwarded to the <div> that hosts the map so callers can set
 * `class`, `style`, `aria-*` etc.  `role` defaults to "application".
 */
export interface MapLibreGLProps extends JSX.HTMLAttributes<HTMLDivElement> {
	/**
	 * Called once the DOM element exists and the maplibre library has been
	 * imported. The callback must return a cleanup function that will be invoked
	 * when the component unmounts.
	 */
	onReady: (args: MapLibreGLReadyArgs) => () => void

	/**
	 * Optional error handler. Defaults to `Sentry.captureException`.
	 */
	onError?: (err: unknown) => void
}

// hook is intentionally unexported; it keeps the implementation details
// local to this module in case we want to reuse it elsewhere later.
interface MapLoaderOptions {
	onReady: (args: MapLibreGLReadyArgs) => () => void
	onError?: (err: unknown) => void
}

function useMapLoader({ onReady, onError }: MapLoaderOptions) {
	let containerRef: HTMLDivElement | undefined | null
	let mounted = true
	let cleanup: (() => void) | undefined

	onMount(async () => {
		// guard against environments without WebGL; maplibre will throw
		// "Failed to initialize WebGL" if neither context is available, so
		// detect early and surface the error via the provided handler.
		const testCanvas = document.createElement('canvas')
		const hasWebGL =
			testCanvas.getContext('webgl') != null ||
			testCanvas.getContext('webgl2') != null
		if (!hasWebGL) {
			onError?.('[MapLibreGL] WebGL is unavailable')
			return
		}

		try {
			const maplibregl = await import('maplibre-gl')
			await import('maplibre-gl/dist/maplibre-gl.css')
			if (!mounted || containerRef == null) return

			cleanup = onReady({
				container: containerRef as HTMLDivElement,
				maplibregl,
			})
		} catch (err) {
			Sentry.captureException(err)
			onError?.(err)
		}
	})

	// ensure we clear the mounted flag and also run any cleanup the loader
	// callback returned.
	onCleanup(() => {
		mounted = false
		cleanup?.()
	})

	return (el: HTMLDivElement | null) => (containerRef = el)
}

/**
 * Lightweight component that handles lazy loading of maplibre-gl and its
 * stylesheet, centralizes error handling/unmount safety, and exposes just
 * the container element and library to callers.
 */
export default function MapLibreGL(props: MapLibreGLProps) {
	// splitProps lets us pull out the pieces we care about and leave the
	// remaining attributes to be forwarded to the <div>.
	const [local, rest] = splitProps(props, [
		'class',
		'onReady',
		'onError',
		'role',
	])

	const [loadError, setLoadError] = createSignal(false)

	const containerRef = useMapLoader({
		onReady: local.onReady,
		onError(err) {
			setLoadError(true)
			local.onError?.(err)
		},
	})

	return (
		<div
			{...rest}
			ref={containerRef}
			role={local.role ?? 'application'}
			class={clsx('maplibregl', local.class)}
		>
			{loadError() && <span class="map-unavailable">Map unavailable</span>}
		</div>
	)
}
