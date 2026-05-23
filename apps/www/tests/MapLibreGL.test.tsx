import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MapLibreGL, {
	type MapLibreGLReadyArgs,
	reportMapLoadedOnce,
} from '@/components/MapLibreGL'

// mock maplibre modules (css stub doesn't need exports)
vi.mock('maplibre-gl', () => ({
	Map: class {},
}))

vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

function mockCreateCanvas(hasWebGL: boolean) {
	const documentCreateElement = document.createElement
	vi
		.spyOn(document, 'createElement')
		.mockImplementation((tagName: string, ...rest) => {
			if (tagName.toLowerCase() === 'canvas') {
				return {
					getContext: () => (hasWebGL ? {} : null),
				} as unknown as HTMLCanvasElement
			}

			return documentCreateElement.call(document, tagName, ...rest)
		})
}

describe('<MapLibreGL>', () => {
	afterEach(() => {
		cleanup()
		vi.restoreAllMocks()
	})

	it('calls onError and shows placeholder when WebGL is unavailable', async () => {
		mockCreateCanvas(false)

		const err = vi.fn()
		const { findByText, queryByRole } = render(() => (
			<MapLibreGL onReady={() => () => {}} onError={err} />
		))

		expect(err).toHaveBeenCalledWith('[MapLibreGL] WebGL is unavailable')
		await expect(findByText('Map unavailable')).resolves.toBeTruthy()
		// skeleton must not be visible alongside the error message
		expect(
			queryByRole('application')?.querySelector('.maplibregl-skeleton')
		).toBeNull()
	})

	it('invokes onReady and runs cleanup on unmount', async () => {
		mockCreateCanvas(true)

		let cleanupCalled = false
		const ready = vi.fn((args: MapLibreGLReadyArgs) => {
			args.onMapLoad()
			return () => {
				cleanupCalled = true
			}
		})

		const { unmount } = render(() => <MapLibreGL onReady={ready} />)
		expect(cleanupCalled).toBeFalsy()

		// Allow onMount to run and load mock libraries asynchornously
		await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1))

		expect(ready.mock.calls[0][0].container).toBeInstanceOf(HTMLDivElement)

		unmount()
		expect(cleanupCalled).toBeTruthy()
	})

	it('shows skeleton and aria-busy before onMapLoad is called', async () => {
		mockCreateCanvas(true)

		const ready = vi.fn((_args: MapLibreGLReadyArgs) => () => {})

		const { container } = render(() => <MapLibreGL onReady={ready} />)

		await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1))

		const host = container.querySelector('.maplibregl')
		expect(host?.getAttribute('aria-busy')).toBe('true')
		expect(host?.querySelector('.maplibregl-skeleton')).not.toBeNull()
		const skeleton = host?.querySelector('.maplibregl-skeleton')
		const status = host?.querySelector('.sr-only')
		expect(skeleton).not.toBeNull()
		expect(status).not.toBeNull()
		expect(skeleton?.contains(status ?? null)).toBe(false)
	})

	it('removes skeleton and aria-busy after onMapLoad is invoked', async () => {
		mockCreateCanvas(true)

		let capturedOnMapLoad: (() => void) | undefined
		const ready = vi.fn((args: MapLibreGLReadyArgs) => {
			capturedOnMapLoad = args.onMapLoad
			return () => {}
		})

		const { container } = render(() => <MapLibreGL onReady={ready} />)

		await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1))
		expect(capturedOnMapLoad).toBeDefined()

		capturedOnMapLoad!()

		await vi.waitFor(() => {
			const host = container.querySelector('.maplibregl')
			expect(host?.getAttribute('aria-busy')).toBe('false')
			expect(host?.querySelector('.maplibregl-skeleton')).toBeNull()
		})
	})

	it('reportMapLoadedOnce invokes onMapLoad on error without load', () => {
		const handlers: Record<string, Array<(e?: { error?: Error }) => void>> = {}
		const map = {
			on(event: string, handler: (e?: { error?: Error }) => void) {
				handlers[event] ??= []
				handlers[event].push(handler)
			},
		} as unknown as import('maplibre-gl').Map

		const onMapLoad = vi.fn()
		reportMapLoadedOnce(map, onMapLoad)

		expect(onMapLoad).not.toHaveBeenCalled()
		handlers.error[0]({ error: new Error('tile failed') })
		expect(onMapLoad).toHaveBeenCalledTimes(1)
	})

	it('reportMapLoadedOnce invokes onMapLoad only once when load follows error', () => {
		const handlers: Record<string, Array<(e?: { error?: Error }) => void>> = {}
		const map = {
			on(event: string, handler: (e?: { error?: Error }) => void) {
				handlers[event] ??= []
				handlers[event].push(handler)
			},
		} as unknown as import('maplibre-gl').Map

		const onMapLoad = vi.fn()
		reportMapLoadedOnce(map, onMapLoad)

		handlers.error[0]({ error: new Error('tile failed') })
		handlers.load[0]()
		expect(onMapLoad).toHaveBeenCalledTimes(1)
	})
})
