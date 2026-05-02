import { Hono } from "hono";
import type { StorageAdapter } from "../storage/StorageAdapter.js";
import { isValidPhotoId, normalizePhotoId } from "../lib/validatePhotoId.js";

/**
 * Build the Hono sub-app for `HEAD /photos/:photoID`.
 *
 * Used by the web app during boot reconciliation to check whether a photo was
 * successfully stored. Returns 200 if the object exists, 404 if not, and 400
 * for invalid photoID format.
 */
export function buildHeadPhotoRouter(storage: StorageAdapter): Hono {
	const router = new Hono();

	// Use router.all() with an explicit method guard so only HEAD is accepted.
	// router.on("HEAD", ...) doesn't propagate through app.route() in Hono 4.x,
	// and router.get() would also match GET — returning 200 with no body, which
	// is semantically wrong for a GET request.
	router.all("/photos/:photoID", async (c) => {
		if (c.req.method !== "HEAD") return c.body(null, 405);

		const rawId = c.req.param("photoID");

		if (!isValidPhotoId(rawId)) {
			return c.body(null, 400);
		}

		// Normalize to lowercase so the storage key is always canonical,
		// regardless of whether the caller supplied an uppercase UUID.
		const photoID = normalizePhotoId(rawId);
		const key = `pub/${photoID}.jpg`;

		let result: { exists: boolean };
		try {
			result = await storage.head(key);
		} catch {
			// TODO (commit 6): Sentry.captureException(err)
			return c.body(null, 502);
		}

		return c.body(null, result.exists ? 200 : 404);
	});

	return router;
}
