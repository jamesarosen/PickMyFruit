import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";
import { buildTransformRouter } from "../../src/routes/transform.js";

/** Build a minimal valid JPEG buffer using Sharp's create API. */
async function makeJpeg(
	width = 10,
	height = 10,
	background: { r: number; g: number; b: number } = { r: 255, g: 0, b: 0 },
): Promise<Buffer> {
	return sharp({
		create: { width, height, channels: 3, background },
	})
		.jpeg()
		.toBuffer();
}

/** Make a fresh isolated app + storage for each test to avoid shared state. */
function makeApp(): { app: Hono; storage: MemoryStorageAdapter } {
	const storage = new MemoryStorageAdapter();
	const app = new Hono();
	app.route("/", buildTransformRouter(storage));
	return { app, storage };
}

describe("POST /transform/:photoID", () => {
	let app: Hono;
	let storage: MemoryStorageAdapter;

	beforeEach(() => {
		({ app, storage } = makeApp());
	});

	describe("happy path", () => {
		it("returns 200 with correct shape for a valid JPEG", async () => {
			const photoID = uuidv7();
			const jpeg = await makeJpeg();

			const res = await app.fetch(
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: jpeg,
					headers: { "content-type": "image/jpeg" },
				}),
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				key: string;
				width: number;
				height: number;
				bytes: number;
				etag: string;
				cached: boolean;
			};
			expect(body.key).toBe(`pub/${photoID}.jpg`);
			expect(body.width).toBeGreaterThan(0);
			expect(body.height).toBeGreaterThan(0);
			expect(body.bytes).toBeGreaterThan(0);
			expect(typeof body.etag).toBe("string");
			expect(body.cached).toBe(false);
		});
	});

	describe("idempotency", () => {
		it("returns cached: true on the second POST with the same photoID", async () => {
			const photoID = uuidv7();
			const jpeg = await makeJpeg();

			const req = () =>
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: jpeg,
					headers: { "content-type": "image/jpeg" },
				});

			const first = await app.fetch(req());
			expect(first.status).toBe(200);
			const firstBody = (await first.json()) as { cached: boolean };
			expect(firstBody.cached).toBe(false);

			const second = await app.fetch(req());
			expect(second.status).toBe(200);
			const secondBody = (await second.json()) as { cached: boolean };
			expect(secondBody.cached).toBe(true);
		});

		it("does not call the transform pipeline twice (storage put called once)", async () => {
			const photoID = uuidv7();
			const jpeg = await makeJpeg();
			let putCount = 0;

			const origPut = storage.put.bind(storage);
			storage.put = async (...args) => {
				putCount++;
				return origPut(...args);
			};

			const req = () =>
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: jpeg,
					headers: { "content-type": "image/jpeg" },
				});

			await app.fetch(req());
			await app.fetch(req());

			expect(putCount).toBe(1);
		});
	});

	describe("validation errors", () => {
		it("returns 400 for a photoID that is not a UUIDv7", async () => {
			const jpeg = await makeJpeg();
			const res = await app.fetch(
				new Request("http://localhost/transform/not-a-uuid", {
					method: "POST",
					body: jpeg,
					headers: { "content-type": "image/jpeg" },
				}),
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("invalid_photo_id");
		});

		it("returns 400 for a UUIDv4 (not UUIDv7)", async () => {
			// UUIDv4 has '4' in the version nibble, not '7'
			const uuidV4 = "550e8400-e29b-41d4-a716-446655440000";
			const jpeg = await makeJpeg();
			const res = await app.fetch(
				new Request(`http://localhost/transform/${uuidV4}`, {
					method: "POST",
					body: jpeg,
					headers: { "content-type": "image/jpeg" },
				}),
			);
			expect(res.status).toBe(400);
		});

		it("returns 413 for a payload exceeding 30 MB (via content-length)", async () => {
			const photoID = uuidv7();
			const res = await app.fetch(
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: new Uint8Array(1),
					headers: {
						"content-type": "image/jpeg",
						"content-length": String(31 * 1024 * 1024),
					},
				}),
			);
			expect(res.status).toBe(413);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("payload_too_large");
		});

		it("returns 415 for a non-image MIME type (plain text)", async () => {
			const photoID = uuidv7();
			const textBuffer = Buffer.from("Hello, world!");
			const res = await app.fetch(
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: textBuffer,
					headers: { "content-type": "text/plain" },
				}),
			);
			expect(res.status).toBe(415);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe("unsupported_media_type");
		});

		it("returns 415 for an empty body", async () => {
			const photoID = uuidv7();
			const res = await app.fetch(
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: new Uint8Array(0),
					headers: { "content-type": "image/jpeg" },
				}),
			);
			expect(res.status).toBe(415);
		});

		it("returns 415 for a PDF disguised as an image", async () => {
			const photoID = uuidv7();
			// PDF magic bytes: %PDF-
			const pdfBytes = Buffer.from("%PDF-1.4 fake pdf content");
			const res = await app.fetch(
				new Request(`http://localhost/transform/${photoID}`, {
					method: "POST",
					body: pdfBytes,
					headers: { "content-type": "image/jpeg" },
				}),
			);
			expect(res.status).toBe(415);
			const body = (await res.json()) as { error: string; mime: string };
			expect(body.error).toBe("unsupported_media_type");
		});
	});
});
