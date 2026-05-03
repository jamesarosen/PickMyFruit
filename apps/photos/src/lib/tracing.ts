/**
 * OTel SDK initialisation for the photo-transform service.
 *
 * In production, spans are exported to Sentry via its OTel span processor.
 * In test environments, call `setTestExporter` with an InMemorySpanExporter
 * before the first request so spans can be inspected without a real collector.
 */
import { trace, propagation, type Tracer } from "@opentelemetry/api";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import {
	NodeTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { SentrySpanProcessor } from "@sentry/opentelemetry";

let _provider: NodeTracerProvider | null = null;

/**
 * Inject a custom exporter for tests.
 *
 * Must be called before the first request. Replaces any previously
 * registered provider so each test can start with a fresh exporter.
 *
 * @internal Do not call from production code.
 */
export function setTestExporter(exporter: SpanExporter): void {
	// Shut down any previous provider so spans don't cross test boundaries.
	_provider?.shutdown().catch(() => undefined);

	const provider = new NodeTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});

	// Register W3C traceparent propagation globally.
	propagation.setGlobalPropagator(new W3CTraceContextPropagator());
	trace.setGlobalTracerProvider(provider);

	_provider = provider;
}

/**
 * Initialise the OTel SDK for production.
 *
 * No-ops when `SENTRY_DSN` is absent (dev / test without explicit DSN).
 * Registers W3C traceparent propagation regardless so the tracer API is
 * always ready for span creation.
 *
 * Call this once at process startup, before any other imports that
 * create spans.
 */
export function initTracing(): void {
	// Always register W3C propagator so extract/inject are available.
	propagation.setGlobalPropagator(new W3CTraceContextPropagator());

	// In test environments let tests inject their own exporter via setTestExporter.
	if (process.env["NODE_ENV"] === "test") return;

	const provider = new NodeTracerProvider({
		spanProcessors: [new SentrySpanProcessor()],
	});
	provider.register();
	_provider = provider;
}

/** Returns the shared tracer for this service. */
export function getTracer(): Tracer {
	return trace.getTracer("pmf-photos");
}
