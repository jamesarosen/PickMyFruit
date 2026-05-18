import { describe, it, expect } from "vitest";
import { parseWorkerEnv } from "../src/env";

const minimal = {
	INTERNAL_API_URL: "http://pickmyfruit.flycast",
	INTERNAL_API_SECRET: "long-enough-internal-api-secret-aaa",
	RESEND_API_KEY: "rk_test",
};

/**
 * @see https://github.com/vitest-dev/vitest/discussions/10369
 */
function assertFalse(val: boolean): asserts val is false {
	expect(val).toBeFalsy();
}

/**
 * @see https://github.com/vitest-dev/vitest/discussions/10369
 */
function assertTrue(val: boolean): asserts val is true {
	expect(val).toBeTruthy();
}

describe(parseWorkerEnv, () => {
	it("parses a minimal valid environment and applies defaults", () => {
		const result = parseWorkerEnv(minimal);
		assertTrue(result.ok);
		const { env } = result;
		expect(env.RESEND_SYNC_POLL_MS).toBe(60_000);
		expect(env.RESEND_SYNC_WORKER_ENABLED).toBeFalsy();
		expect(env.RESEND_API_RATE_PER_SEC).toBe(4);
		expect(env.RESEND_API_BUCKET_CAPACITY).toBe(4);
		expect(env.RESEND_SYNC_CURSOR_PATH).toBe(
			"/app/data/resend-sync/cursor.json",
		);
		expect(env.RESEND_API_KEY).toBe("rk_test");
		expect(env.NODE_ENV).toBe("development");
	});

	it("fails when RESEND_API_KEY is missing", () => {
		const { RESEND_API_KEY: _omit, ...rest } = minimal;
		const result = parseWorkerEnv(rest);
		assertFalse(result.ok);
		expect(
			result.error.issues.some((i) => i.path.includes("RESEND_API_KEY")),
		).toBeTruthy();
	});

	it("coerces numeric env vars from strings", () => {
		const result = parseWorkerEnv({
			...minimal,
			RESEND_SYNC_POLL_MS: "5000",
			RESEND_API_RATE_PER_SEC: "2.5",
		});
		if (!result.ok) throw new Error(result.error.message);
		expect(result.env.RESEND_SYNC_POLL_MS).toBe(5000);
		expect(result.env.RESEND_API_RATE_PER_SEC).toBe(2.5);
	});

	it("coerces RESEND_SYNC_WORKER_ENABLED to boolean", () => {
		const on = parseWorkerEnv({
			...minimal,
			RESEND_SYNC_WORKER_ENABLED: "true",
		});
		if (!on.ok) throw new Error(on.error.message);
		expect(on.env.RESEND_SYNC_WORKER_ENABLED).toBeTruthy();

		const off = parseWorkerEnv({
			...minimal,
			RESEND_SYNC_WORKER_ENABLED: "false",
		});
		if (!off.ok) throw new Error(off.error.message);
		expect(off.env.RESEND_SYNC_WORKER_ENABLED).toBeFalsy();
	});

	it("requires INTERNAL_API_SECRET to be 32+ chars", () => {
		const result = parseWorkerEnv({ ...minimal, INTERNAL_API_SECRET: "short" });
		assertFalse(result.ok);
		expect(
			result.error.issues.some((i) => i.path.includes("INTERNAL_API_SECRET")),
		).toBeTruthy();
	});

	it("requires INTERNAL_API_URL to be a URL", () => {
		const result = parseWorkerEnv({
			...minimal,
			INTERNAL_API_URL: "not a url",
		});
		expect(result.ok).toBeFalsy();
	});

	it("requires SENTRY_DSN to be a URL when provided", () => {
		expect(
			parseWorkerEnv({
				...minimal,
				SENTRY_DSN: "https://key@o123.ingest.sentry.io/456",
			}).ok,
		).toBeTruthy();
		expect(
			parseWorkerEnv({ ...minimal, SENTRY_DSN: "not-a-url" }).ok,
		).toBeFalsy();
	});

	it("coerces SENTRY_ENABLED to boolean", () => {
		const on = parseWorkerEnv({ ...minimal, SENTRY_ENABLED: "true" });
		if (!on.ok) throw new Error(on.error.message);
		expect(on.env.SENTRY_ENABLED).toBeTruthy();

		const off = parseWorkerEnv({ ...minimal, SENTRY_ENABLED: "false" });
		if (!off.ok) throw new Error(off.error.message);
		expect(off.env.SENTRY_ENABLED).toBeFalsy();
	});

	it("returns a discriminated result instead of throwing", () => {
		expect(() => parseWorkerEnv({ NODE_ENV: "production" })).not.toThrow();
		expect(parseWorkerEnv({}).ok).toBeFalsy();
	});
});
