/**
 * Tests for OTel tracing on POST /transform/:photoID.
 *
 * Uses an InMemorySpanExporter to capture spans without a real collector.
 * Verifies parent-child relationship when traceparent is present and that
 * required attributes are attached to the span.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import {
	NodeTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { propagation, trace } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";
import { buildTransformRouter } from "../../src/routes/transform.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { _resetForTesting } from "../../src/lib/coldStart.js";
import { setTestExporter } from "../../src/lib/tracing.js";

/** Build a minimal valid JPEG buffer using Sharp's create API. */
async function makeJpeg(): Promise<Buffer> {
	return sharp({
		create: {
			width: 10,
			height: 10,
			channels: 3,
			background: { r: 0, g: 128, b: 0 },
		},
	})
		.jpeg()
		.toBuffer();
}

function makeApp(): { app: Hono; storage: MemoryStorageAdapter } {
	const storage = new MemoryStorageAdapter();
	const app = new Hono();
	app.use("*", async (c, next) => authMiddleware(c, next));
	app.route("/", buildTransformRouter(storage));
	return { app, storage };
}

describe("OTel tracing on POST /transform/:photoID", () => {
	let exporter: InMemorySpanExporter;
	let provider: NodeTracerProvider;
	let app: Hono;

	beforeEach(() => {
		_resetForTesting();

		exporter = new InMemorySpanExporter();
		provider = new NodeTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});

		// Register W3C propagator so extract/inject work correctly.
		propagation.setGlobalPropagator(new W3CTraceContextPropagator());
		trace.setGlobalTracerProvider(provider);

		// Inject the in-memory exporter into the tracing module.
		setTestExporter(exporter);

		({ app } = makeApp());
	});

	afterEach(async () => {
		await provider.shutdown();
		// Reset global providers so they don't bleed between tests.
		trace.disable();
		propagation.disable();
	});

	it("creates a span for the transform request", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();
		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		expect(spans.length).toBeGreaterThan(0);
	});

	it("child span has the incoming traceparent as parent when traceparent header is set", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		// Create a fake parent trace context.
		const parentTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
		const parentSpanId = "00f067aa0ba902b7";
		const traceparent = `00-${parentTraceId}-${parentSpanId}-01`;

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
					traceparent,
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();

		// Parent trace context should match the incoming traceparent.
		const parentCtx = transformSpan!.parentSpanContext;
		expect(parentCtx).toBeDefined();
		expect(parentCtx!.traceId).toBe(parentTraceId);
		expect(parentCtx!.spanId).toBe(parentSpanId);
	});

	it("span has no parent when no traceparent header is set", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();
		expect(transformSpan!.parentSpanContext).toBeUndefined();
	});

	it("span carries photo.id attribute", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();
		expect(transformSpan!.attributes["photo.id"]).toBe(photoID);
	});

	it("span carries transform.name = 'default'", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan!.attributes["transform.name"]).toBe("default");
	});

	it("span carries bytes_in, coldStart, bootMs attributes", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();
		const attrs = transformSpan!.attributes;
		expect(typeof attrs["bytes_in"]).toBe("number");
		expect(attrs["bytes_in"] as number).toBeGreaterThan(0);
		expect(typeof attrs["coldStart"]).toBe("boolean");
		expect(typeof attrs["bootMs"]).toBe("number");
	});

	it("span carries bytes_out, width, height, mime_in, mime_out on successful transform", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();
		const attrs = transformSpan!.attributes;
		expect(typeof attrs["bytes_out"]).toBe("number");
		expect(typeof attrs["width"]).toBe("number");
		expect(typeof attrs["height"]).toBe("number");
		expect(typeof attrs["mime_in"]).toBe("string");
		expect(attrs["mime_out"]).toBe("image/jpeg");
	});

	it("span carries sharpMs and tigrisPutMs timing attributes", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		expect(res.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const transformSpan = spans.find((s) => s.name === "transform");
		expect(transformSpan).toBeDefined();
		const attrs = transformSpan!.attributes;
		expect(typeof attrs["sharpMs"]).toBe("number");
		expect(typeof attrs["tigrisPutMs"]).toBe("number");
	});
});
