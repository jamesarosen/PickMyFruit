import { describe, it, expect } from "vitest";
import { parseWorkerEnv } from "../src/env";

const minimalResend = {
	INTERNAL_API_URL: "http://pickmyfruit.flycast",
	INTERNAL_API_SECRET: "long-enough-internal-api-secret-aaa",
	RESEND_SYNC_PROVIDER: "resend",
	RESEND_API_KEY: "rk_test",
	RESEND_AUDIENCE_ID: "aud_1",
};

const minimalDisabled = {
	INTERNAL_API_URL: "http://pickmyfruit.flycast",
	INTERNAL_API_SECRET: "long-enough-internal-api-secret-aaa",
	RESEND_SYNC_PROVIDER: "disabled",
	NODE_ENV: "development",
};

describe("parseWorkerEnv", () => {
	it("parses a minimal valid `resend` environment with defaults", () => {
		const result = parseWorkerEnv(minimalResend as NodeJS.ProcessEnv);
		if (!result.ok) throw new Error(result.error.message);
		const env = result.env;
		expect(env.RESEND_SYNC_POLL_MS).toBe(60_000);
		expect(env.RESEND_API_RATE_PER_SEC).toBe(4);
		expect(env.RESEND_API_BUCKET_CAPACITY).toBe(4);
		expect(env.RESEND_SYNC_CURSOR_PATH).toBe(
			"/app/data/resend-sync/cursor.json",
		);
		expect(env.SENTRY_ENVIRONMENT).toBe("resend-sync");
		expect(env.NODE_ENV).toBe("production");
		expect(env.provider).toEqual({
			RESEND_SYNC_PROVIDER: "resend",
			RESEND_API_KEY: "rk_test",
			RESEND_AUDIENCE_ID: "aud_1",
		});
	});

	it("parses a `disabled` environment without requiring Resend credentials", () => {
		const result = parseWorkerEnv(minimalDisabled as NodeJS.ProcessEnv);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.env.provider).toEqual({ RESEND_SYNC_PROVIDER: "disabled" });
	});

	it("coerces numeric env vars", () => {
		const result = parseWorkerEnv({
			...minimalResend,
			RESEND_SYNC_POLL_MS: "5000",
			RESEND_API_RATE_PER_SEC: "2.5",
		} as NodeJS.ProcessEnv);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.env.RESEND_SYNC_POLL_MS).toBe(5000);
		expect(result.env.RESEND_API_RATE_PER_SEC).toBe(2.5);
	});

	it("requires INTERNAL_API_SECRET to be 32+ chars", () => {
		const result = parseWorkerEnv({
			...minimalResend,
			INTERNAL_API_SECRET: "short",
		} as NodeJS.ProcessEnv);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(
			result.error.issues.some((i) => i.path.includes("INTERNAL_API_SECRET")),
		).toBe(true);
	});

	it("requires INTERNAL_API_URL to be a URL", () => {
		const result = parseWorkerEnv({
			...minimalResend,
			INTERNAL_API_URL: "not a url",
		} as NodeJS.ProcessEnv);
		expect(result.ok).toBe(false);
	});

	it("rejects `resend` provider without RESEND_API_KEY", () => {
		const { RESEND_API_KEY: _omit, ...rest } = minimalResend;
		const result = parseWorkerEnv(rest as NodeJS.ProcessEnv);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(
			result.error.issues.some((i) => i.path.includes("RESEND_API_KEY")),
		).toBe(true);
	});

	it("rejects `disabled` provider in production", () => {
		const result = parseWorkerEnv({
			...minimalDisabled,
			NODE_ENV: "production",
		} as NodeJS.ProcessEnv);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(
			result.error.issues.some((i) => i.path.includes("RESEND_SYNC_PROVIDER")),
		).toBe(true);
	});

	it("returns a discriminated result instead of throwing", () => {
		expect(() =>
			parseWorkerEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv),
		).not.toThrow();
		const result = parseWorkerEnv({} as NodeJS.ProcessEnv);
		expect(result.ok).toBe(false);
	});
});
