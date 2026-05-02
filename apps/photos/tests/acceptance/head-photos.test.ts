import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import { Readable } from "node:stream";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";
import { buildTransformRouter } from "../../src/routes/transform.js";
import { buildHeadPhotoRouter } from "../../src/routes/headPhoto.js";
import { authMiddleware } from "../../src/middleware/auth.js";

/** Build a fresh isolated app mirroring the production wiring. */
function makeApp(): { app: Hono; storage: MemoryStorageAdapter } {
	const storage = new MemoryStorageAdapter();
	const app = new Hono();

	app.use("/transform/*", authMiddleware);
	app.use("/photos/*", authMiddleware);

	app.get("/health", (c) => c.json({ ok: true }));
	app.route("/", buildTransformRouter(storage));
	app.route("/", buildHeadPhotoRouter(storage));

	return { app, storage };
}

/** Store a dummy object directly in storage to simulate a previously-transformed photo. */
async function seedPhoto(
	storage: MemoryStorageAdapter,
	photoID: string,
): Promise<void> {
	const buf = Buffer.from("fake-jpeg");
	await storage.put(
		`pub/${photoID}.jpg`,
		Readable.from(buf),
		"image/jpeg",
		buf.length,
	);
}

describe("auth middleware", () => {
	let app: Hono;

	beforeEach(() => {
		({ app } = makeApp());
	});

	it("returns 401 when x-internal-token header is missing on /transform/:photoID", async () => {
		const photoID = uuidv7();
		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: Buffer.from("data"),
				headers: { "content-type": "image/jpeg" },
			}),
		);
		expect(res.status).toBe(401);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("unauthorized");
	});

	it("returns 401 when x-internal-token header has wrong value on /transform/:photoID", async () => {
		const photoID = uuidv7();
		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: Buffer.from("data"),
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "wrong-token",
				},
			}),
		);
		expect(res.status).toBe(401);
	});

	it("proceeds past auth (not 401) when correct token is provided on /transform/:photoID", async () => {
		const photoID = uuidv7();
		const res = await app.fetch(
			new Request(`http://localhost/transform/${photoID}`, {
				method: "POST",
				body: Buffer.from("not-an-image"),
				headers: {
					"content-type": "image/jpeg",
					"x-internal-token": "test-token",
				},
			}),
		);
		// Auth passes; route logic may return a non-401 error (e.g. 415 for bad image)
		expect(res.status).not.toBe(401);
	});

	it("returns 200 on GET /health with no token (auth not required)", async () => {
		const res = await app.fetch(
			new Request("http://localhost/health", { method: "GET" }),
		);
		expect(res.status).toBe(200);
	});
});

describe("HEAD /photos/:photoID", () => {
	let app: Hono;
	let storage: MemoryStorageAdapter;

	beforeEach(() => {
		({ app, storage } = makeApp());
	});

	it("returns 200 when the photo exists in storage", async () => {
		const photoID = uuidv7();
		await seedPhoto(storage, photoID);

		const res = await app.fetch(
			new Request(`http://localhost/photos/${photoID}`, {
				method: "HEAD",
				headers: { "x-internal-token": "test-token" },
			}),
		);
		expect(res.status).toBe(200);
	});

	it("returns 404 when the photo does not exist in storage", async () => {
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/photos/${photoID}`, {
				method: "HEAD",
				headers: { "x-internal-token": "test-token" },
			}),
		);
		expect(res.status).toBe(404);
	});

	it("returns 400 for a photoID that is not a UUIDv7", async () => {
		const res = await app.fetch(
			new Request("http://localhost/photos/not-a-uuid", {
				method: "HEAD",
				headers: { "x-internal-token": "test-token" },
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns 401 when the token is wrong", async () => {
		const photoID = uuidv7();

		const res = await app.fetch(
			new Request(`http://localhost/photos/${photoID}`, {
				method: "HEAD",
				headers: { "x-internal-token": "bad-token" },
			}),
		);
		expect(res.status).toBe(401);
	});
});
