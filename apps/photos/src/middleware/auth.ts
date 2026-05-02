import type { MiddlewareHandler } from "hono";

/**
 * Resolve the internal token from the environment.
 *
 * In test/memory mode (`NODE_ENV === 'test'` or `STORAGE_PROVIDER === 'memory'`),
 * default to `"test-token"` so tests work without env config. In all other
 * environments, require `INTERNAL_TOKEN` to be set or throw at startup.
 */
function resolveInternalToken(): string {
	const token = process.env["INTERNAL_TOKEN"];
	if (token) return token;

	const isTestMode =
		process.env["NODE_ENV"] === "test" ||
		(process.env["STORAGE_PROVIDER"] ?? "memory") === "memory";

	if (isTestMode) return "test-token";

	throw new Error(
		"INTERNAL_TOKEN env var is required when NODE_ENV !== 'test' and STORAGE_PROVIDER !== 'memory'",
	);
}

/** Shared secret loaded once at startup. */
const INTERNAL_TOKEN = resolveInternalToken();

/**
 * Hono middleware that enforces `x-internal-token` header authentication.
 *
 * Returns 401 if the header is absent or does not match the configured secret.
 * Must NOT be applied to `GET /health`.
 */
export const authMiddleware: MiddlewareHandler = async (c, next) => {
	const provided = c.req.header("x-internal-token");
	if (!provided || provided !== INTERNAL_TOKEN) {
		return c.json({ error: "unauthorized" }, 401);
	}
	await next();
};
