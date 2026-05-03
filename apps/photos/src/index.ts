import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import sharp from "sharp";
import { MemoryStorageAdapter } from "./storage/MemoryStorageAdapter.js";
import { TigrisStorageAdapter } from "./storage/TigrisStorageAdapter.js";
import type { StorageAdapter } from "./storage/StorageAdapter.js";
import { buildTransformRouter } from "./routes/transform.js";
import { buildHeadPhotoRouter } from "./routes/headPhoto.js";
import { authMiddleware } from "./middleware/auth.js";
import { initTracing } from "./lib/tracing.js";
import { initSentry } from "./lib/sentry.js";

// Initialise observability before anything else so all spans and errors
// are captured from process start.
initTracing();
initSentry();

const startedAt = Date.now();

/** Resolve and validate the storage adapter from environment variables. */
function createStorageAdapter(): StorageAdapter {
	const provider = process.env["STORAGE_PROVIDER"] ?? "memory";

	if (provider === "tigris") {
		const tigrisEnv = z
			.object({
				AWS_ACCESS_KEY_ID: z.string().min(1),
				AWS_SECRET_ACCESS_KEY: z.string().min(1),
				AWS_ENDPOINT_URL_S3: z.string().url(),
				BUCKET_NAME: z.string().min(1),
			})
			.parse(process.env);

		return new TigrisStorageAdapter({
			bucketName: tigrisEnv.BUCKET_NAME,
			accessKeyId: tigrisEnv.AWS_ACCESS_KEY_ID,
			secretAccessKey: tigrisEnv.AWS_SECRET_ACCESS_KEY,
			endpointUrl: tigrisEnv.AWS_ENDPOINT_URL_S3,
		});
	}

	// Default: memory adapter (used in tests and local dev without env config).
	return new MemoryStorageAdapter();
}

const storage = createStorageAdapter();

const app = new Hono();

/** Liveness probe used by Fly.io and the www app to warm the service. */
app.get("/health", (c) => {
	return c.json({
		ok: true,
		uptimeMs: Date.now() - startedAt,
		sharpVersion: sharp.versions.sharp,
	});
});

// All routes except /health require the x-internal-token header.
// Registering globally and carving out /health explicitly ensures any future
// route is protected by default rather than requiring a new use() call.
app.use("*", async (c, next) => {
	if (c.req.path === "/health") return next();
	return authMiddleware(c, next);
});

app.route("/", buildTransformRouter(storage));
app.route("/", buildHeadPhotoRouter(storage));

// Only start the HTTP server when this module is run directly, not when
// imported by tests, so tests can call app.request() without binding a port.
if (process.argv[1] === new URL(import.meta.url).pathname) {
	const port = Number(process.env["PORT"] ?? 8080);
	serve({ fetch: app.fetch, port });
}

export default app;
