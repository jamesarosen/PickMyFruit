import { Readable } from "node:stream";
import { Hono } from "hono";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import type { StorageAdapter } from "../storage/StorageAdapter.js";
import { isValidPhotoId, normalizePhotoId } from "../lib/validatePhotoId.js";

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
}

/**
 * Build the Hono sub-app for `POST /transform/:photoID`.
 *
 * Accepts a raw JPEG/PNG/WebP body, transforms it with Sharp, stores the
 * result in the provided StorageAdapter under `pub/{photoID}.jpg`, and
 * returns metadata. Subsequent calls with the same photoID return the
 * cached result without re-transforming.
 */
export function buildTransformRouter(storage: StorageAdapter): Hono {
	const router = new Hono();

	router.post("/transform/:photoID", async (c) => {
		const rawId = c.req.param("photoID");

		// Validate that photoID is a valid UUIDv7.
		if (!isValidPhotoId(rawId)) {
			return c.json({ error: "invalid_photo_id" }, 400);
		}

		// Normalize to lowercase so the storage key is always canonical,
		// regardless of whether the caller supplied an uppercase UUID.
		const photoID = normalizePhotoId(rawId);
		const key = `pub/${photoID}.jpg`;

		// HEAD before transform: idempotency check. Not atomic — two concurrent
		// requests for the same photoID could both transform and PUT. In practice
		// the web caller assigns UUIDs and pending rows atomically, making this
		// unlikely. The second PUT overwrites with identical content.
		const headResult = await storage.head(key);
		if (headResult.exists && headResult.etag && headResult.size !== undefined) {
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
			});
		}

		// Read body in chunks, reject as soon as limit crossed.
		const reader = c.req.raw.body?.getReader();
		if (!reader) {
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
				return c.json({ error: "payload_too_large" }, 413);
			}
			chunks.push(value);
		}
		const inputBuffer = Buffer.concat(chunks);

		if (inputBuffer.length === 0) {
			return c.json({ error: "unsupported_media_type", mime: "" }, 415);
		}

		// MIME sniff from the first bytes to reject non-image payloads.
		const fileType = await fileTypeFromBuffer(inputBuffer);
		if (!fileType || !fileType.mime.startsWith("image/")) {
			return c.json(
				{ error: "unsupported_media_type", mime: fileType?.mime ?? "" },
				415,
			);
		}

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
		try {
			const result = await sharpPipeline.toBuffer({ resolveWithObject: true });
			outputBuffer = result.data;
			info = result.info;
		} catch (err) {
			// TODO (commit 6): Sentry.captureException(err)
			return c.json({ error: "transform_failed" }, 422);
		}

		const width = info.width;
		const height = info.height;

		// Store the result.
		let putResult: { etag: string };
		try {
			putResult = await storage.put(
				key,
				Readable.from(outputBuffer),
				"image/jpeg",
				outputBuffer.length,
			);
		} catch (err) {
			// TODO (commit 6): Sentry.captureException(err)
			return c.json({ error: "storage_failed" }, 502);
		}

		return c.json<TransformResponse>({
			key,
			width,
			height,
			bytes: outputBuffer.length,
			etag: putResult.etag,
			cached: false,
		});
	});

	return router;
}
