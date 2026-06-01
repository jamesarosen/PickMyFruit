import { createClient, type Client } from '@libsql/client/node'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRuntime, DurableRuntime } from '../src/runtime.server.ts'
import type { KokotoTelemetry } from '../src/types.ts'

const tempDbs = new Set<string>()

/**
 * Create a fresh libsql client backed by a temp file. The caller owns the
 * connection — close it in `afterEach`; the file is cleaned on process exit.
 *
 * Why not `:memory:`? libsql 0.5.x's in-memory mode drops the entire
 * `sqlite_master` view on `tx.rollback()`, which would make `ctx.txStep`
 * tests fail spuriously. A temp file behaves like real SQLite.
 */
export async function newClient(): Promise<Client> {
	const dir = mkdtempSync(join(tmpdir(), 'kokoto-test-'))
	const path = join(dir, 'test.db')
	tempDbs.add(dir)
	const client = createClient({ url: `file:${path}` })
	await client.execute('PRAGMA foreign_keys = ON')
	await client.execute('PRAGMA busy_timeout = 5000')
	return client
}

process.once('exit', () => {
	for (const dir of tempDbs) {
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// best-effort
		}
	}
})

export interface CapturedMetric {
	name: string
	value: number
	attrs: Record<string, string | number>
	kind: 'count' | 'distribution'
}

export interface CapturedLog {
	level: 'info' | 'debug' | 'warn'
	fields: Record<string, unknown>
	msg: string
}

/** Telemetry sink that records every emission for assertion. */
export function makeRecorder(): {
	telemetry: KokotoTelemetry
	metrics: CapturedMetric[]
	logs: CapturedLog[]
	exceptions: unknown[]
} {
	const metrics: CapturedMetric[] = []
	const logs: CapturedLog[] = []
	const exceptions: unknown[] = []
	return {
		metrics,
		logs,
		exceptions,
		telemetry: {
			incrementCounter(name, value, attrs) {
				metrics.push({ name, value, attrs: attrs ?? {}, kind: 'count' })
			},
			recordDistribution(name, value, attrs) {
				metrics.push({ name, value, attrs: attrs ?? {}, kind: 'distribution' })
			},
			captureException(err) {
				exceptions.push(err)
			},
			logInfo(fields, msg) {
				logs.push({ level: 'info', fields, msg })
			},
			logDebug(fields, msg) {
				logs.push({ level: 'debug', fields, msg })
			},
			logWarn(fields, msg) {
				logs.push({ level: 'warn', fields, msg })
			},
		},
	}
}

/** Build + start a runtime with the kokoto schema already applied. */
export async function newRuntime(opts: {
	client: Client
	telemetry?: KokotoTelemetry
	pollMs?: number
	leaseMs?: number
	globalConcurrency?: number
}): Promise<DurableRuntime> {
	const runtime = createRuntime({
		client: opts.client as never,
		telemetry: opts.telemetry,
		pollMs: opts.pollMs ?? 25,
		leaseMs: opts.leaseMs ?? 5_000,
		globalConcurrency: opts.globalConcurrency,
	})
	await runtime.createSchema()
	return runtime
}

/** Sleep helper used to give the dispatcher a few ticks between assertions. */
export async function sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, ms))
}
