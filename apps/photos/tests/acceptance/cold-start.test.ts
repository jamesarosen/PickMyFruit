import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import sharp from "sharp";
import { uuidv7 } from "uuidv7";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";
import { buildTransformRouter } from "../../src/routes/transform.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { _resetForTesting } from "../../src/lib/coldStart.js";

/** Build a minimal valid JPEG buffer using Sharp's create API. */
async function makeJpeg(): Promise<Buffer> {
	return sharp({
		create: {
			width: 10,
			height: 10,
			channels: 3,
			background: { r: 255, g: 0, b: 0 },
		},
	})
		.jpeg()
		.toBuffer();
}

/** Make a fresh isolated app + storage for each test to avoid shared state. */
function makeApp(): { app: Hono; storage: MemoryStorageAdapter } {
	const storage = new MemoryStorageAdapter();
	const app = new Hono();
	app.use("*", async (c, next) => authMiddleware(c, next));
	app.route("/", buildTransformRouter(storage));
	return { app, storage };
}

/** Build a POST /transform request with auth token included. */
function transformRequest(photoID: string, body: Buffer): Request {
	return new Request(`http://localhost/transform/${photoID}`, {
		method: "POST",
		body,
		headers: {
			"content-type": "image/jpeg",
			"x-internal-token": "test-token",
		},
	});
}

describe("cold-start tracking in POST /transform/:photoID", () => {
	let app: Hono;

	beforeEach(() => {
		// Reset cold-start state before each test so tests are independent.
		_resetForTesting();
		({ app } = makeApp());
	});

	it("first request has coldStart: true and bootMs >= 0", async () => {
		const jpeg = await makeJpeg();
		const res = await app.fetch(transformRequest(uuidv7(), jpeg));

		expect(res.status).toBe(200);
		const body = (await res.json()) as { coldStart: boolean; bootMs: number };
		expect(body.coldStart).toBe(true);
		expect(body.bootMs).toBeGreaterThanOrEqual(0);
	});

	it("second request has coldStart: false", async () => {
		const jpeg = await makeJpeg();

		// First request flips the flag.
		await app.fetch(transformRequest(uuidv7(), jpeg));

		// Second request — new photoID to avoid the cache path, but cold-start
		// flag should already be false.
		const res = await app.fetch(transformRequest(uuidv7(), jpeg));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { coldStart: boolean };
		expect(body.coldStart).toBe(false);
	});

	it("bootMs reflects elapsed time when fakeStartedAt is in the past", async () => {
		// Simulate a process that booted 500 ms ago.
		_resetForTesting(Date.now() - 500);

		const jpeg = await makeJpeg();
		const res = await app.fetch(transformRequest(uuidv7(), jpeg));

		expect(res.status).toBe(200);
		const body = (await res.json()) as { bootMs: number };
		expect(body.bootMs).toBeGreaterThanOrEqual(500);
	});

	it("cached-path response also includes coldStart and bootMs", async () => {
		const jpeg = await makeJpeg();
		const photoID = uuidv7();

		// First request: store the photo.
		await app.fetch(transformRequest(photoID, jpeg));

		// Reset so next request is treated as cold start again.
		_resetForTesting();

		// Second request hits the cached (HEAD) path.
		const res = await app.fetch(transformRequest(photoID, jpeg));
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			cached: boolean;
			coldStart: boolean;
			bootMs: number;
		};
		expect(body.cached).toBe(true);
		expect(body.coldStart).toBe(true);
		expect(body.bootMs).toBeGreaterThanOrEqual(0);
	});

	// Concurrent-request ordering (first finally wins) is not easily tested via
	// app.fetch() since requests are sequential in the test runtime. This would
	// require real concurrency (Worker threads or actual HTTP server). Skipped.
});
