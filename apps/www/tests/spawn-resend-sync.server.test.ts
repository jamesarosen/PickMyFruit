import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
	attachWorkerSupervision,
	shouldSpawnResendSyncWorker,
	spawnResendSyncWorkerIfEnabled,
	type SupervisedChild,
} from '@/lib/spawn-resend-sync.server'

/** Minimal stand-in for ChildProcess used by the supervisor. */
class FakeChild extends EventEmitter implements SupervisedChild {
	killed: NodeJS.Signals | null = null
	kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		this.killed = signal
		return true
	}
}

describe(shouldSpawnResendSyncWorker, () => {
	it.each([
		[{ RESEND_SYNC_WORKER_ENABLED: 'true' }, true],
		[{ RESEND_SYNC_WORKER_ENABLED: 'false' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: '' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: 'TRUE' }, false],
		[{ RESEND_SYNC_WORKER_ENABLED: '1' }, false],
		[{}, false],
	])('shouldSpawn(%j) → %s', (env, expected) => {
		expect(shouldSpawnResendSyncWorker(env)).toBe(expected)
	})
})

describe(attachWorkerSupervision, () => {
	it('captures non-zero exits via the injected Sentry hook', () => {
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
			'resend-sync',
			'worker-child-crashed',
		])
	})

	it('does not capture a clean exit (code 0)', () => {
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

describe(spawnResendSyncWorkerIfEnabled, () => {
	it('returns null and never spawns when the gate is off', () => {
		const spawn = vi.fn()
		const result = spawnResendSyncWorkerIfEnabled(
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
		const fakeChild = new FakeChild()
		const spawn = vi.fn<
			(
				cmd: string,
				args: readonly string[],
				opts: Record<string, unknown>
			) => SupervisedChild
		>(() => fakeChild)
		const result = spawnResendSyncWorkerIfEnabled(
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
