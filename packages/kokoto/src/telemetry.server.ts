import type { KokotoTelemetry } from './types.ts'

/**
 * Single choke point for runtime observability. All metric/log emission goes
 * through these helpers so callers can wire Sentry/pino without scattering
 * conditional checks throughout the runtime.
 *
 * Metric naming follows the issue plan (`kokoto.<noun>.<verb>`); attribute
 * cardinality is intentionally low — workflow name, queue, step name, and
 * status only. Never include workflow id, user id, or email.
 */
export class Telemetry {
	private readonly sink: KokotoTelemetry

	constructor(sink: KokotoTelemetry = {}) {
		this.sink = sink
	}

	count(
		metric: string,
		attributes: Record<string, string | number> = {},
		value = 1
	): void {
		this.sink.incrementCounter?.(metric, value, attributes)
	}

	distribution(
		metric: string,
		value: number,
		attributes: Record<string, string | number> = {}
	): void {
		this.sink.recordDistribution?.(metric, value, attributes)
	}

	captureException(
		err: unknown,
		ctx?: { workflow?: string; step?: string }
	): void {
		this.sink.captureException?.(err, ctx)
	}

	info(fields: Record<string, unknown>, msg: string): void {
		this.sink.logInfo?.(fields, msg)
	}

	debug(fields: Record<string, unknown>, msg: string): void {
		this.sink.logDebug?.(fields, msg)
	}

	warn(fields: Record<string, unknown>, msg: string): void {
		this.sink.logWarn?.(fields, msg)
	}
}

/** Metric name constants — keeps spellings consistent across the runtime. */
export const Metrics = {
	workflowEnqueued: 'kokoto.workflow.enqueued',
	workflowDispatched: 'kokoto.workflow.dispatched',
	workflowFinished: 'kokoto.workflow.finished',
	workflowRecovered: 'kokoto.workflow.recovered',
	workflowReplay: 'kokoto.workflow.replay',
	stepStarted: 'kokoto.step.started',
	stepFinished: 'kokoto.step.finished',
	stepFailed: 'kokoto.step.failed',
	stepReplayed: 'kokoto.step.replayed',
	stepDurationMs: 'kokoto.step.duration_ms',
	dispatchClaimed: 'kokoto.dispatch.claimed',
	bootQuickCheckFailed: 'kokoto.boot.quick_check_failed',
} as const
