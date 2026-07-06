import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	RELOAD_LOOP_WINDOW_MS,
	RELOAD_MARKER_KEY,
	createPreloadErrorHandler,
	installStaleAssetRecovery,
	type StaleAssetRecoveryDeps,
} from '../src/lib/stale-asset-recovery'
import { Sentry } from '../src/lib/sentry'

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: vi.fn(),
		captureMessage: vi.fn(),
	},
}))

const NOW = 1_750_000_000_000

function fakeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial))
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value),
		map,
	}
}

function fireChunkLoadError(deps: StaleAssetRecoveryDeps) {
	const event = {
		payload: new Error('Failed to fetch'),
		preventDefault: vi.fn(),
	}
	createPreloadErrorHandler(deps)(event)
	return event
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('createPreloadErrorHandler', () => {
	it('reloads the page and records the reload time on the first failure', () => {
		const storage = fakeStorage()
		const reload = vi.fn()

		const event = fireChunkLoadError({ storage, reload, now: () => NOW })

		expect(reload).toHaveBeenCalledOnce()
		expect(event.preventDefault).toHaveBeenCalledOnce()
		expect(storage.map.get(RELOAD_MARKER_KEY)).toBe(String(NOW))
		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ level: 'warning' })
		)
	})

	it('lets the error propagate instead of reloading again within the loop window', () => {
		const storage = fakeStorage({
			[RELOAD_MARKER_KEY]: String(NOW - RELOAD_LOOP_WINDOW_MS + 1),
		})
		const reload = vi.fn()

		const event = fireChunkLoadError({ storage, reload, now: () => NOW })

		expect(reload).not.toHaveBeenCalled()
		expect(event.preventDefault).not.toHaveBeenCalled()
		expect(Sentry.captureException).toHaveBeenCalledWith(
			event.payload,
			expect.objectContaining({
				tags: { staleAssetRecovery: 'reload-loop' },
			})
		)
	})

	it('reloads again once the loop window has passed', () => {
		const storage = fakeStorage({
			[RELOAD_MARKER_KEY]: String(NOW - RELOAD_LOOP_WINDOW_MS),
		})
		const reload = vi.fn()

		fireChunkLoadError({ storage, reload, now: () => NOW })

		expect(reload).toHaveBeenCalledOnce()
	})

	it.each(['', 'garbage', 'NaN'])(
		'treats an unparseable reload marker (%j) as no previous reload',
		(marker) => {
			const storage = fakeStorage({ [RELOAD_MARKER_KEY]: marker })
			const reload = vi.fn()

			fireChunkLoadError({ storage, reload, now: () => NOW })

			expect(reload).toHaveBeenCalledOnce()
		}
	)
})

describe('installStaleAssetRecovery', () => {
	it('registers the vite:preloadError listener only once', () => {
		const addEventListener = vi.spyOn(window, 'addEventListener')

		installStaleAssetRecovery()
		installStaleAssetRecovery()

		const preloadErrorRegistrations = addEventListener.mock.calls.filter(
			([type]) => type === 'vite:preloadError'
		)
		expect(preloadErrorRegistrations).toHaveLength(1)
	})
})
