import { afterEach, describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
	attachWorkerSupervision,
	defaultResolveWorkerPath,
	shouldSpawnResendWorker,
	spawnResendWorkerIfEnabled,
	type SupervisedChild,
} from '@/lib/spawn-resend-worker.server'

/** Minimal stand-in for ChildProcess used by the supervisor. */
class FakeChild extends EventEmitter implements SupervisedChild {
	killed: NodeJS.Signals | null = null
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		this.killed = signal
		return true
	}
}

describe(shouldSpawnResendWorker, () => {
	it.each([
		[{ RESEND_SYNC_WORKER_ENABLED: 'true' }, true],
		[{ RESEND_SYNC_WORKER_ENABLED: 'false' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: '' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: 'TRUE' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: '1' }, false],
		[{}, false],
	])('shouldSpawn(%j) → %s', (env, expected) => {
		expect.hasAssertions()
		expect(shouldSpawnResendWorker(env)).toBe(expected)
	})
})

describe(attachWorkerSupervision, () => {
	it('captures non-zero exits via the injected Sentry hook', () => {
		expect.hasAssertions()
		const child = new FakeChild()
		const captureException = vi.fn()
		attachWorkerSupervision(child, {
			captureException,
			onParentSignal: () => undefined,
		})
		child.emit('exit', 2, null)
		expect(captureException).toHaveBeenCalledTimes(1)
		const [err, ctx] = captureException.mock.calls[0]
		expect((err as Error).message).toMatch(/code=2/)
		expect((ctx as { fingerprint: string[] }).fingerprint).toEqual([
			'resend-worker',
			'worker-child-crashed',
		])
	})

	it('does not capture a clean exit (code 0)', () => {
		expect.hasAssertions()
		const child = new FakeChild()
		const captureException = vi.fn()
		attachWorkerSupervision(child, {
			captureException,
			onParentSignal: () => undefined,
		})
		child.emit('exit', 0, null)
		expect(captureException).not.toHaveBeenCalled()
	})

	it('treats SIGTERM/SIGINT termination as clean (operator-driven)', () => {
		expect.hasAssertions()
		const child = new FakeChild()
		const captureException = vi.fn()
		attachWorkerSupervision(child, {
			captureException,
			onParentSignal: () => undefined,
		})
		child.emit('exit', null, 'SIGTERM')
		child.emit('exit', null, 'SIGINT')
		expect(captureException).not.toHaveBeenCalled()
	})

	it('forwards parent SIGTERM and SIGINT to the child', () => {
		expect.hasAssertions()
		const child = new FakeChild()
		const handlers = new Map<string, () => void>()
		attachWorkerSupervision(child, {
			captureException: vi.fn(),
			onParentSignal: (signal, handler) => {
				handlers.set(signal, handler)
			},
		})
		handlers.get('SIGTERM')?.()
		expect(child.killed).toBe('SIGTERM')

		const child2 = new FakeChild()
		const handlers2 = new Map<string, () => void>()
		attachWorkerSupervision(child2, {
			captureException: vi.fn(),
			onParentSignal: (signal, handler) => {
				handlers2.set(signal, handler)
			},
		})
		handlers2.get('SIGINT')?.()
		expect(child2.killed).toBe('SIGINT')
	})
})

describe(defaultResolveWorkerPath, () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// PICKMYFRUIT-1N: in the production Docker runner image the bundled file
	// lives at /app/.output/server/_ssr/spawn-resend-worker.server-*.mjs. None
	// of its node_modules ancestors contain @pickmyfruit/resend-worker — the
	// package is not a declared www dependency and the Dockerfile runner
	// stage does not copy pnpm's virtual store. The fix lets the runtime
	// supply an explicit, absolute worker path via RESEND_SYNC_WORKER_PATH
	// so resolution does not depend on Node's node_modules walk.
	it('honors RESEND_SYNC_WORKER_PATH when set (PICKMYFRUIT-1N)', () => {
		expect.hasAssertions()
		const sentinel = '/app/apps/resend-worker/dist/main.js'
		vi.stubEnv('RESEND_SYNC_WORKER_PATH', sentinel)
		expect(defaultResolveWorkerPath()).toBe(sentinel)
	})

	// Pins the dev/test fallback: when no env override is set, the function
	// must delegate to Node's resolver (`createRequire(...).resolve(...)`).
	// Asserting on the resolved path is environment-dependent because the
	// resolver verifies the package's `main` file exists, which requires
	// `apps/resend-worker/dist/main.js` to have been built. CI runs tests
	// before any build, so we instead assert that the function attempts
	// the package-name resolution — either it returns a path that lives
	// under apps/resend-worker (built locally) or it throws MODULE_NOT_FOUND
	// (CI). Both prove the fallback is intact; a future refactor that
	// short-circuits past `require.resolve` would fail this test by
	// returning some other value or throwing a different error.
	it('falls back to require.resolve when RESEND_SYNC_WORKER_PATH is unset', () => {
		expect.hasAssertions()
		vi.stubEnv('RESEND_SYNC_WORKER_PATH', '')
		// CI (no dist built) throws MODULE_NOT_FOUND; dev (dist built) returns
		// a path under apps/resend-worker/. Capture either outcome as a string,
		// then assert once — both signals prove require.resolve was reached.
		let outcome: string
		try {
			outcome = defaultResolveWorkerPath()
		} catch (err) {
			outcome = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN'
		}
		expect(outcome).toMatch(/(?:apps[/\\]resend-worker[/\\])|^MODULE_NOT_FOUND$/)
	})

	// End-to-end guard: the env var must flow all the way through
	// spawnResendWorkerIfEnabled to the spawned child's argv, not just
	// through the helper. Catches regressions where the caller wires its own
	// resolver instead of going through defaultResolveWorkerPath.
	it('propagates RESEND_SYNC_WORKER_PATH into the spawned child argv', () => {
		expect.hasAssertions()
		const sentinel = '/app/apps/resend-worker/dist/main.js'
		vi.stubEnv('RESEND_SYNC_WORKER_PATH', sentinel)
		const fakeChild = new FakeChild()
		const spawn = vi.fn<
			(
				cmd: string,
				args: readonly string[],
				opts: Record<string, unknown>
			) => SupervisedChild
		>(() => fakeChild)
		spawnResendWorkerIfEnabled(
			{ RESEND_SYNC_WORKER_ENABLED: 'true' },
			{
				spawn: spawn as unknown as typeof import('node:child_process').spawn,
				supervisionDeps: {
					captureException: vi.fn(),
					onParentSignal: () => undefined,
				},
			}
		)
		const [, args] = spawn.mock.calls[0]
		expect(args).toStrictEqual([sentinel])
	})
})

describe(spawnResendWorkerIfEnabled, () => {
	it('returns null and never spawns when the gate is off', () => {
		expect.hasAssertions()
		const spawn = vi.fn()
		const result = spawnResendWorkerIfEnabled(
			{ RESEND_SYNC_WORKER_ENABLED: 'false' },
			{
				spawn: spawn as unknown as typeof import('node:child_process').spawn,
				resolveWorkerPath: () => '/fake/worker.js',
			}
		)
		expect(result).toBeNull()
		expect(spawn).not.toHaveBeenCalled()
	})

	it('spawns with the worker path + inherited stdio when the gate is on', () => {
		expect.hasAssertions()
		const fakeChild = new FakeChild()
		const spawn = vi.fn<
			(
				cmd: string,
				args: readonly string[],
				opts: Record<string, unknown>
			) => SupervisedChild
		>(() => fakeChild)
		const result = spawnResendWorkerIfEnabled(
			{ RESEND_SYNC_WORKER_ENABLED: 'true' },
			{
				spawn: spawn as unknown as typeof import('node:child_process').spawn,
				resolveWorkerPath: () => '/abs/path/to/main.js',
				supervisionDeps: {
					captureException: vi.fn(),
					onParentSignal: () => undefined,
				},
			}
		)
		expect(result).toBe(fakeChild)
		expect(spawn).toHaveBeenCalledTimes(1)
		const [cmd, args, opts] = spawn.mock.calls[0]
		expect(cmd).toBe(process.execPath)
		expect(args).toStrictEqual(['/abs/path/to/main.js'])
		expect(opts).toMatchObject({ stdio: 'inherit' })
	})
})
