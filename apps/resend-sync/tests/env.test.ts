import { describe, it, expect } from "vitest";
import { parseWorkerEnv } from "../src/env";

const valid = {
	INTERNAL_API_URL: "http://pickmyfruit.flycast",
	INTERNAL_API_SECRET: "long-enough-internal-api-secret-aaa",
	RESEND_API_KEY: "rk_test",
	RESEND_AUDIENCE_ID: "aud_1",
};

describe("parseWorkerEnv", () => {
	it("parses a minimal valid environment with defaults", () => {
		const env = parseWorkerEnv(valid as NodeJS.ProcessEnv);
		expect(env.RESEND_SYNC_POLL_MS).toBe(60_000);
		expect(env.RESEND_API_RATE_PER_SEC).toBe(4);
		expect(env.RESEND_API_BUCKET_CAPACITY).toBe(4);
		expect(env.RESEND_SYNC_CURSOR_PATH).toBe(
			"/app/data/resend-sync/cursor.json",
		);
		expect(env.SENTRY_ENVIRONMENT).toBe("resend-sync");
		expect(env.NODE_ENV).toBe("production");
	});

	it("coerces numeric env vars", () => {
		const env = parseWorkerEnv({
			...valid,
			RESEND_SYNC_POLL_MS: "5000",
			RESEND_API_RATE_PER_SEC: "2.5",
		} as NodeJS.ProcessEnv);
		expect(env.RESEND_SYNC_POLL_MS).toBe(5000);
		expect(env.RESEND_API_RATE_PER_SEC).toBe(2.5);
	});

	it("requires INTERNAL_API_SECRET to be 32+ chars", () => {
		expect(() =>
			parseWorkerEnv({
				...valid,
				INTERNAL_API_SECRET: "short",
			} as NodeJS.ProcessEnv),
		).toThrow(/INTERNAL_API_SECRET/);
	});

	it("requires INTERNAL_API_URL to be a URL", () => {
		expect(() =>
			parseWorkerEnv({
				...valid,
				INTERNAL_API_URL: "not a url",
			} as NodeJS.ProcessEnv),
		).toThrow(/INTERNAL_API_URL/);
	});

	it("throws when required Resend vars are missing", () => {
		const { RESEND_API_KEY: _omit, ...rest } = valid;
		expect(() => parseWorkerEnv(rest as NodeJS.ProcessEnv)).toThrow(
			/RESEND_API_KEY/,
		);
	});
});
