import { serve } from "@hono/node-server";
import { Hono } from "hono";
import sharp from "sharp";

// TODO (commit 6): wire in Sentry for exception capture

const startedAt = Date.now();

const app = new Hono();

/** Liveness probe used by Fly.io and the www app to warm the service. */
app.get("/health", (c) => {
	return c.json({
		ok: true,
		uptimeMs: Date.now() - startedAt,
		sharpVersion: sharp.versions.sharp,
	});
});

// Only start the HTTP server when this module is run directly, not when
// imported by tests, so tests can call app.request() without binding a port.
if (process.argv[1] === new URL(import.meta.url).pathname) {
	const port = Number(process.env["PORT"] ?? 8080);
	serve({ fetch: app.fetch, port });
}

export default app;
