import { describe, it, expect, vi } from "vitest";
import { handleResendEmail } from "../src/jobs";
import type { TokenBucket } from "../src/token-bucket";

vi.mock(import("../src/sentry"), () => ({
	Sentry: { captureException: vi.fn() },
}));
vi.mock(import("../src/logger"), () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const noopBucket: TokenBucket = {
	take: async () => undefined,
	honorRetryAfter: async () => undefined,
};

describe(handleResendEmail, () => {
	it("dispatches `noop` to the no-op branch and returns ok", async () => {
		const result = await handleResendEmail(
			{ type: "noop" },
			{ bucket: noopBucket },
		);
		expect(result).toStrictEqual({ kind: "ok" });
	});

	it("`inquiry-email` is unimplemented in Slice 1 and returns fail", async () => {
		const result = await handleResendEmail(
			{
				type: "inquiry-email",
				from: "noreply@example.com",
				to: "owner@example.com",
				subject: "Someone wants your apples",
				html: "<p>hi</p>",
			},
			{ bucket: noopBucket },
		);
		expect(result).toStrictEqual({
			kind: "fail",
			error: "handler-unimplemented",
		});
	});

	it("`newsletter-opt-out` is unimplemented in Slice 1 and returns fail", async () => {
		const result = await handleResendEmail(
			{ type: "newsletter-opt-out", email: "u@example.com" },
			{ bucket: noopBucket },
		);
		expect(result).toStrictEqual({
			kind: "fail",
			error: "handler-unimplemented",
		});
	});
});
