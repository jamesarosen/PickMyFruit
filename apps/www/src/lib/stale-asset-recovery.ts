import { Sentry } from '@/lib/sentry'

/**
 * Structural shape of Vite's `vite:preloadError` event, kept minimal so unit
 * tests can fire plain objects instead of constructing real DOM events.
 */
export interface ChunkPreloadErrorEvent {
	payload: Error
	preventDefault(): void
}

/** Injectable dependencies for `createPreloadErrorHandler`. */
export interface StaleAssetRecoveryDeps {
	storage: Pick<Storage, 'getItem' | 'setItem'>
	reload(): void
	now(): number
}

/** sessionStorage key holding the timestamp of the last recovery reload. */
export const RELOAD_MARKER_KEY = 'pmf:stale-asset-reload-at'

/**
 * Two chunk-load failures within this window mean the reload did not fix the
 * problem — the 404 is not deploy staleness — so the second failure is allowed
 * to propagate instead of reloading forever.
 */
export const RELOAD_LOOP_WINDOW_MS = 30_000

/** Builds the `vite:preloadError` handler with injected dependencies. */
export function createPreloadErrorHandler(deps: StaleAssetRecoveryDeps) {
	return (event: ChunkPreloadErrorEvent): void => {
		const lastReloadAt = Number(deps.storage.getItem(RELOAD_MARKER_KEY)) || 0
		if (deps.now() - lastReloadAt < RELOAD_LOOP_WINDOW_MS) {
			Sentry.captureException(event.payload, {
				tags: { staleAssetRecovery: 'reload-loop' },
			})
			return
		}
		deps.storage.setItem(RELOAD_MARKER_KEY, String(deps.now()))
		Sentry.captureMessage('Reloading after stale asset chunk load failure', {
			level: 'warning',
			tags: { staleAssetRecovery: 'reload' },
		})
		event.preventDefault()
		deps.reload()
	}
}

let installed = false

/**
 * Recovers from hashed asset chunks 404ing after a deploy by reloading the
 * page, which completes the in-flight navigation on the new build. Reloads at
 * most once per `RELOAD_LOOP_WINDOW_MS`; repeat failures propagate to the
 * router error boundary. See docs/0014-stale-asset-recovery.md.
 */
export function installStaleAssetRecovery(): void {
	if (installed) return
	installed = true
	window.addEventListener(
		'vite:preloadError',
		createPreloadErrorHandler({
			storage: window.sessionStorage,
			reload: () => window.location.reload(),
			now: Date.now,
		})
	)
}
