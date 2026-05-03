import { Readable } from "node:stream";
import { Hono } from "hono";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { propagation, context, SpanStatusCode } from "@opentelemetry/api";
import type { StorageAdapter } from "../storage/StorageAdapter.js";
import { isValidPhotoId, normalizePhotoId } from "../lib/validatePhotoId.js";
import {
	getColdStartInfo,
	markFirstRequestComplete,
} from "../lib/coldStart.js";
import { getTracer } from "../lib/tracing.js";
import { captureException } from "../lib/sentry.js";

// Apply Sharp global settings once at module load, not per-request.
sharp.concurrency(1);
sharp.cache(false);

/** Maximum accepted raw-body size: 30 MB. */
const MAX_BYTES = 30 * 1024 * 1024;

/** Response shape for a successful transform (or cache hit). */
interface TransformResponse {
	key: string;
	width: number | null;
	height: number | null;
	bytes: number | null;
	etag: string | null;
	cached: boolean;
	coldStart: boolean;
	bootMs: number;
}

/**
 * Build the Hono sub-app for `POST /transform/:photoID`.
 *
 * Accepts a raw JPEG/PNG/WebP body, transforms it with Sharp, stores the
 * result in the provided StorageAdapter under `pub/{photoID}.jpg`, and
 * returns metadata. Subsequent calls with the same photoID return the
 * cached result without re-transforming.
 *
 * Each request creates an OTel span named "transform" that is a child of any
 * incoming W3C traceparent context. Span attributes follow the ADR spec.
 */
export function buildTransformRouter(storage: StorageAdapter): Hono {
	const router = new Hono();

	router.post("/transform/:photoID", async (c) => {
		// Capture cold-start state and flip the flag synchronously before any await.
		// Node.js is single-threaded between await points, so this is atomic — no
		// concurrent request can read the flag between getColdStartInfo() and
		// markFirstRequestComplete(). Placing this before photoID validation ensures
		// any request that reaches the handler marks the service as warm.
		const coldStartInfo = getColdStartInfo();
		markFirstRequestComplete();

		const rawId = c.req.param("photoID");

		// Validate that photoID is a valid UUIDv7.
		if (!isValidPhotoId(rawId)) {
			return c.json({ error: "invalid_photo_id" }, 400);
		}

		// Normalize to lowercase so the storage key is always canonical,
		// regardless of whether the caller supplied an uppercase UUID.
		const photoID = normalizePhotoId(rawId);
		const key = `pub/${photoID}.jpg`;

		// Extract W3C traceparent from the incoming headers so the request span
		// becomes a child of the caller's trace when present.
		const headerCarrier: Record<string, string> = {};
		for (const [k, v] of Object.entries(c.req.header())) {
			headerCarrier[k] = v as string;
		}
		const parentCtx = propagation.extract(context.active(), headerCarrier);

		const tracer = getTracer();
		const span = tracer.startSpan("transform", {}, parentCtx);

		// All span work happens inside a context that makes this span the active one.
		return context.with(context.active(), async () => {
			try {
				span.setAttribute("photo.id", photoID);
				span.setAttribute("transform.name", "default");
				span.setAttribute("coldStart", coldStartInfo.coldStart);
				span.setAttribute("bootMs", coldStartInfo.bootMs);

				// HEAD before transform: idempotency check. Not atomic — two concurrent
				// requests for the same photoID could both transform and PUT. In practice
				// the web caller assigns UUIDs and pending rows atomically, making this
				// unlikely. The second PUT overwrites with identical content.
				const tigrisHeadStart = Date.now();
				const headResult = await storage.head(key);
				span.setAttribute("tigrisHeadMs", Date.now() - tigrisHeadStart);

				if (
					headResult.exists &&
					headResult.etag &&
					headResult.size !== undefined
				) {
					span.setAttribute("bytes_out", headResult.size ?? 0);
					span.end();
					// We don't store dimensions in the object store, so width/height cannot
					// be recovered from a HEAD-only response without fetching the full image.
					// TODO(commit-5): store width/height in object metadata on PUT so the
					// cached path can return real values.
					return c.json<TransformResponse>({
						key,
						width: null,
						height: null,
						bytes: headResult.size ?? null,
						etag: headResult.etag ?? null,
						cached: true,
						...coldStartInfo,
					});
				}

				// Read body in chunks, reject as soon as limit crossed.
				const reader = c.req.raw.body?.getReader();
				if (!reader) {
					span.end();
					return c.json({ error: "no_body" }, 400);
				}
				const chunks: Uint8Array[] = [];
				let totalBytes = 0;
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					totalBytes += value.length;
					if (totalBytes > MAX_BYTES) {
						await reader.cancel();
						span.end();
						return c.json({ error: "payload_too_large" }, 413);
					}
					chunks.push(value);
				}
				const inputBuffer = Buffer.concat(chunks);
				span.setAttribute("bytes_in", inputBuffer.length);

				if (inputBuffer.length === 0) {
					span.end();
					return c.json({ error: "unsupported_media_type", mime: "" }, 415);
				}

				// MIME sniff from the first bytes to reject non-image payloads.
				const fileType = await fileTypeFromBuffer(inputBuffer);
				if (!fileType || !fileType.mime.startsWith("image/")) {
					span.end();
					return c.json(
						{ error: "unsupported_media_type", mime: fileType?.mime ?? "" },
						415,
					);
				}
				span.setAttribute("mime_in", fileType.mime);

				// Transform: auto-orient (strips EXIF) first so resize operates on the
				// correct logical dimensions, then resize to max 1600 px wide, encode JPEG.
				// .rotate() must precede .resize(): a portrait shot stored as 3024×4032
				// with EXIF rotation 90° would otherwise be resized to 1600×2144 (wrong
				// axis) before rotation flips it to 2144×1600 — exceeding the 1600 px cap.
				const sharpPipeline = sharp(inputBuffer, { sequentialRead: true })
					.rotate() // applies EXIF orientation then strips EXIF
					.resize({ width: 1600, withoutEnlargement: true })
					.jpeg({ quality: 85 });

				let outputBuffer: Buffer;
				let info: sharp.OutputInfo;
				const sharpStart = Date.now();
				try {
					const result = await sharpPipeline.toBuffer({
						resolveWithObject: true,
					});
					outputBuffer = result.data;
					info = result.info;
				} catch (err) {
					captureException(err);
					span.setStatus({ code: SpanStatusCode.ERROR });
					span.end();
					return c.json({ error: "transform_failed" }, 422);
				}
				span.setAttribute("sharpMs", Date.now() - sharpStart);

				const width = info.width;
				const height = info.height;
				span.setAttribute("width", width);
				span.setAttribute("height", height);
				span.setAttribute("bytes_out", outputBuffer.length);
				span.setAttribute("mime_out", "image/jpeg");

				// Store the result.
				let putResult: { etag: string };
				const tigrisPutStart = Date.now();
				try {
					putResult = await storage.put(
						key,
						Readable.from(outputBuffer),
						"image/jpeg",
						outputBuffer.length,
					);
				} catch (err) {
					captureException(err);
					span.setAttribute("tigrisPutMs", Date.now() - tigrisPutStart);
					span.setStatus({ code: SpanStatusCode.ERROR });
					span.end();
					return c.json({ error: "storage_failed" }, 502);
				}
				span.setAttribute("tigrisPutMs", Date.now() - tigrisPutStart);

				span.end();
				return c.json<TransformResponse>({
					key,
					width,
					height,
					bytes: outputBuffer.length,
					etag: putResult.etag,
					cached: false,
					...coldStartInfo,
				});
			} catch (err) {
				captureException(err);
				span.setStatus({ code: SpanStatusCode.ERROR });
				span.end();
				throw err;
			}
		});
	});

	return router;
}
