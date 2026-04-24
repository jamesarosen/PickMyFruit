import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	trackVisualViewport,
	VISUAL_VIEWPORT_BOTTOM_INSET_VAR,
	VISUAL_VIEWPORT_HEIGHT_VAR,
} from '../src/lib/visual-viewport'

type Listener = () => void

interface MockVisualViewport {
	height: number
	offsetTop: number
	listeners: Map<string, Set<Listener>>
	addEventListener: (type: string, listener: Listener) => void
	removeEventListener: (type: string, listener: Listener) => void
	dispatch: (type: string) => void
}

function createMockVisualViewport(
	initial: { height: number; offsetTop: number } = { height: 800, offsetTop: 0 }
): MockVisualViewport {
	const listeners = new Map<string, Set<Listener>>()
	return {
		height: initial.height,
		offsetTop: initial.offsetTop,
		listeners,
		addEventListener(type, listener) {
			const set = listeners.get(type) ?? new Set<Listener>()
			set.add(listener)
			listeners.set(type, set)
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener)
		},
		dispatch(type) {
			for (const l of listeners.get(type) ?? []) l()
		},
	}
}

describe('trackVisualViewport', () => {
	let originalVV: VisualViewport | undefined
	let target: HTMLElement

	beforeEach(() => {
		originalVV = window.visualViewport ?? undefined
		target = document.createElement('div')
		document.body.append(target)
		Object.defineProperty(window, 'innerHeight', {
			configurable: true,
			value: 800,
		})
	})

	afterEach(() => {
		target.remove()
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: originalVV,
		})
	})

	it('writes both CSS variables using visualViewport metrics on mount', () => {
		const vv = createMockVisualViewport({ height: 500, offsetTop: 0 })
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: vv,
		})

		const dispose = trackVisualViewport(target)

		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe(
			'500px'
		)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'300px'
		)
		dispose()
	})

	it('updates CSS variables when the visual viewport resizes', () => {
		const vv = createMockVisualViewport({ height: 800, offsetTop: 0 })
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: vv,
		})

		const dispose = trackVisualViewport(target)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'0px'
		)

		vv.height = 450
		vv.dispatch('resize')

		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe(
			'450px'
		)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'350px'
		)
		dispose()
	})

	it('accounts for offsetTop when the visual viewport scrolls', () => {
		const vv = createMockVisualViewport({ height: 500, offsetTop: 100 })
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: vv,
		})

		const dispose = trackVisualViewport(target)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'200px'
		)
		dispose()
	})

	it('clamps negative insets to zero', () => {
		const vv = createMockVisualViewport({ height: 900, offsetTop: 50 })
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: vv,
		})

		const dispose = trackVisualViewport(target)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'0px'
		)
		dispose()
	})

	it('removes listeners and clears variables on dispose', () => {
		const vv = createMockVisualViewport({ height: 500, offsetTop: 0 })
		const removeSpy = vi.spyOn(vv, 'removeEventListener')
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: vv,
		})

		const dispose = trackVisualViewport(target)
		dispose()

		expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
		expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe('')
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			''
		)
	})

	it('falls back to window.innerHeight when VisualViewport is unavailable', () => {
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: undefined,
		})

		const dispose = trackVisualViewport(target)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe(
			'800px'
		)
		expect(target.style.getPropertyValue(VISUAL_VIEWPORT_BOTTOM_INSET_VAR)).toBe(
			'0px'
		)
		dispose()
	})
})
