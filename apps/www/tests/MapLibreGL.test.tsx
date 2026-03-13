import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MapLibreGL from '@/components/MapLibreGL'

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
		const { findByText } = render(() => (
			<MapLibreGL onReady={() => () => {}} onError={err} />
		))

		expect(err).toHaveBeenCalledWith('[MapLibreGL] WebGL is unavailable')
		await expect(findByText('Map unavailable')).resolves.toBeTruthy()
	})

	it('invokes onReady and runs cleanup on unmount', async () => {
		mockCreateCanvas(true)

		let cleanupCalled = false
		const ready = vi.fn(() => () => {
			cleanupCalled = true
		})

		const { unmount } = render(() => <MapLibreGL onReady={ready} />)
		expect(cleanupCalled).toBeFalsy()

		// Allow onMount to run and load mock libraries asynchornously
		await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1))

		/* @ts-expect-error vitest incorrectly types mock.calls[0] as Array<never> */
		expect(ready.mock.calls[0][0].container).toBeInstanceOf(HTMLDivElement)

		unmount()
		expect(cleanupCalled).toBeTruthy()
	})
})
