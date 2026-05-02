import { timingSafeEqual, createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/**
 * Constant-time string comparison via SHA-256 digests.
 *
 * Hashing both sides to equal length before comparing prevents
 * `timingSafeEqual` from throwing on unequal-length inputs while
 * keeping the comparison resistant to timing attacks.
 */
function safeTokenEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

/**
 * Resolve the internal token from the environment.
 *
 * In test mode (`NODE_ENV === 'test'`), default to `"test-token"` so tests
 * work without env config. In all other environments, require `INTERNAL_TOKEN`
 * to be set or throw at startup.
 *
 * Note: `STORAGE_PROVIDER` intentionally does not influence this decision.
 * A missing `STORAGE_PROVIDER` (which falls back to `"memory"`) is acceptable
 * for storage, but must never silently enable the public test token in production.
 */
function resolveInternalToken(): string {
	const token = process.env["INTERNAL_TOKEN"];
	if (token) return token;

	if (process.env["NODE_ENV"] === "test") return "test-token";

	throw new Error(
		"INTERNAL_TOKEN env var is required when NODE_ENV !== 'test'",
	);
}

/** Shared secret loaded once at startup. */
const INTERNAL_TOKEN = resolveInternalToken();

/**
 * Hono middleware that enforces `x-internal-token` header authentication.
 *
 * Returns 401 if the header is absent or does not match the configured secret.
 * Uses a constant-time comparison to prevent timing attacks.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
	const provided = c.req.header("x-internal-token");
	if (!provided || !safeTokenEqual(provided, INTERNAL_TOKEN)) {
		return c.json({ error: "unauthorized" }, 401);
	}
	await next();
};
