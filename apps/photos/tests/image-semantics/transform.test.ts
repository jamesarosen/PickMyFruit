import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";
import { buildTransformRouter } from "../../src/routes/transform.js";

/** Build a minimal valid JPEG using Sharp's create API. */
async function makeJpeg(width = 40, height = 30): Promise<Buffer> {
	return sharp({
		create: {
			width,
			height,
			channels: 3,
			background: { r: 100, g: 150, b: 200 },
		},
	})
		.jpeg()
		.toBuffer();
}

function makeApp(): Hono {
	const storage = new MemoryStorageAdapter();
	const app = new Hono();
	app.route("/", buildTransformRouter(storage));
	return app;
}

describe("image semantics: POST /transform/:photoID", () => {
	it("output is valid JPEG with correct dimensions (≤1600px wide)", async () => {
		const app = makeApp();
		const photoID = uuidv7();
		// Use a recognisable size to confirm dimensions pass through
		const jpeg = await makeJpeg(400, 300);

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: { "content-type": "image/jpeg" },
			}),
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			width: number;
			height: number;
			bytes: number;
		};
		// 400px wide input should not be enlarged
		expect(body.width).toBe(400);
		expect(body.height).toBe(300);
		expect(body.bytes).toBeGreaterThan(0);
	});

	it("does not enlarge images narrower than 1600px (withoutEnlargement)", async () => {
		const app = makeApp();
		const photoID = uuidv7();
		const jpeg = await makeJpeg(200, 100);

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: { "content-type": "image/jpeg" },
			}),
		);

		const body = (await res.json()) as { width: number; height: number };
		expect(body.width).toBeLessThanOrEqual(200);
		expect(body.height).toBeLessThanOrEqual(100);
	});

	it("downsizes images wider than 1600px to exactly 1600px wide", async () => {
		const app = makeApp();
		const photoID = uuidv7();
		const jpeg = await makeJpeg(3200, 2400);

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpeg,
				headers: { "content-type": "image/jpeg" },
			}),
		);

		const body = (await res.json()) as { width: number; height: number };
		expect(body.width).toBe(1600);
		// aspect ratio preserved: 3200×2400 → 1600×1200
		expect(body.height).toBe(1200);
	});

	it("strips EXIF from output JPEG", async () => {
		const app = makeApp();
		const photoID = uuidv7();

		// Add EXIF to the source JPEG via withMetadata
		const jpegWithExif = await sharp({
			create: {
				width: 20,
				height: 20,
				channels: 3,
				background: { r: 255, g: 128, b: 0 },
			},
		})
			.jpeg()
			.withMetadata({ exif: { IFD0: { Copyright: "Test Owner" } } })
			.toBuffer();

		// Confirm source has EXIF
		const srcMeta = await sharp(jpegWithExif).metadata();
		expect(srcMeta.exif).toBeDefined();

		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpegWithExif,
				headers: { "content-type": "image/jpeg" },
			}),
		);

		expect(res.status).toBe(200);

		// The output lives in MemoryStorageAdapter — retrieve it by peeking at
		// the response bytes field, but we need the actual output bytes.
		// Re-run the transform on a fresh app with same input and read from storage.
		const storage = new MemoryStorageAdapter();
		const app2 = new Hono();
		const { buildTransformRouter: btr } =
			await import("../../src/routes/transform.js");
		app2.route("/", btr(storage));

		const res2 = await app2.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: jpegWithExif,
				headers: { "content-type": "image/jpeg" },
			}),
		);
		expect(res2.status).toBe(200);

		// Pull the stored bytes from MemoryStorageAdapter (access private store via cast)
		const storeMap = (
			storage as unknown as { store: Map<string, { data: Buffer }> }
		).store;
		const stored = storeMap.get(`pub/${photoID}.jpg`);
		expect(stored).toBeDefined();

		const outMeta = await sharp(stored!.data).metadata();
		// .rotate() without arguments applies orientation and strips EXIF orientation;
		// combined with JPEG encode (no .withMetadata()), all EXIF should be absent.
		expect(outMeta.exif).toBeUndefined();
	});

	// TODO: test EXIF-orientation auto-rotate using real orientation-encoded JPEGs.
	// Generating those programmatically with Sharp requires writing raw EXIF bytes,
	// which is non-trivial. Use fixture files with real camera images in a future PR.
});
