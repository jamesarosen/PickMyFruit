import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'

/**
 * Reads the `RESEND_SYNC_WORKER_ENABLED` env gate. Anything other than the
 * literal string `'true'` is treated as "off" — empty/unset/typoed values
 * fail closed (no worker spawned).
 */
export function shouldSpawnResendSyncWorker(
	env: Record<string, string | undefined>
): boolean {
	return env.RESEND_SYNC_WORKER_ENABLED === 'true'
}

/** Subset of the ChildProcess API used by the supervisor; lets tests pass a fake. */
export interface SupervisedChild {
	on(
		event: 'exit',
		listener: (code: number | null, signal: NodeJS.Signals | null) => void
	): unknown
	kill(signal?: NodeJS.Signals): boolean
}

export interface AttachSupervisionDeps {
	captureException?: (err: unknown, ctx?: Record<string, unknown>) => void
	onParentSignal?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void
}

/**
 * Wires up two things on a spawned worker child:
 * - On non-zero exit, log + Sentry-capture. Zero exit (gate disabled, graceful
 *   drain) is silent. The worker is *not* auto-restarted; the container restart
 *   policy catches a crash.
 * - On parent SIGTERM/SIGINT, forward the same signal to the child so the
 *   worker can finish its in-flight row and write the cursor before exiting.
 */
export function attachWorkerSupervision(
	child: SupervisedChild,
	deps: AttachSupervisionDeps = {}
): void {
	const captureException = deps.captureException ?? Sentry.captureException
	const onParentSignal =
		deps.onParentSignal ??
		((signal, handler) => {
			process.once(signal, handler)
		})

	child.on('exit', (code, signal) => {
		if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
			logger.info({ code, signal }, 'resend-sync worker child exited cleanly')
			return
		}
		const err = new Error(
			`resend-sync worker child exited with code=${code} signal=${signal}`
		)
		logger.error({ code, signal }, 'resend-sync worker child crashed')
		captureException(err, {
			fingerprint: ['resend-sync', 'worker-child-crashed'],
			extra: { code, signal },
		})
	})

	onParentSignal('SIGTERM', () => {
		child.kill('SIGTERM')
	})
	onParentSignal('SIGINT', () => {
		child.kill('SIGINT')
	})
}

export interface SpawnResendSyncDeps {
	/** Injected for tests; defaults to Node's child_process.spawn. */
	spawn?: typeof nodeSpawn
	/** Resolves the worker entrypoint. Defaults to `@pickmyfruit/resend-sync`. */
	resolveWorkerPath?: () => string
	/** Hooks for the exit + signal wiring. */
	supervisionDeps?: AttachSupervisionDeps
}

const defaultResolveWorkerPath = (): string => {
	const require = createRequire(import.meta.url)
	return require.resolve('@pickmyfruit/resend-sync')
}

/**
 * Production entry point: spawns the resend-sync worker as a child of the web
 * server when `RESEND_SYNC_WORKER_ENABLED=true`. No-ops otherwise.
 *
 * Why spawn from www instead of a separate Fly machine: we collapse two Fly
 * Machines into one (saving cost) without sacrificing the security model — the
 * worker still talks to www over `pickmyfruit.flycast` with `INTERNAL_API_SECRET`
 * and Fly-Src verification, so graduation back to a separate Machine is just
 * "delete this call from start.ts".
 *
 * Returns the spawned child (or null when the gate is off) so callers in tests
 * can assert against it.
 */
export function spawnResendSyncWorkerIfEnabled(
	env: Record<string, string | undefined> = process.env,
	deps: SpawnResendSyncDeps = {}
): ChildProcess | SupervisedChild | null {
	if (!shouldSpawnResendSyncWorker(env)) {
		logger.info(
			'resend-sync worker disabled (set RESEND_SYNC_WORKER_ENABLED=true to enable)'
		)
		return null
	}

	const spawn = deps.spawn ?? nodeSpawn
	const resolveWorkerPath = deps.resolveWorkerPath ?? defaultResolveWorkerPath
	const workerPath = resolveWorkerPath()

	logger.info({ workerPath }, 'resend-sync worker spawning')
	const child = spawn(process.execPath, [workerPath], {
		stdio: 'inherit',
		env: process.env,
	})

	attachWorkerSupervision(child, deps.supervisionDeps)
	return child
}
