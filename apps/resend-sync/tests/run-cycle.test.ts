import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCycle } from "../src/run-cycle";
import { readCursorFile } from "../src/cursor-file";
import type { InternalApiClient } from "../src/internal-api-client";
import type { ResendUpsert } from "../src/resend-client";
import type { TokenBucket } from "../src/token-bucket";

vi.mock("../src/sentry", () => ({
	Sentry: { captureException: vi.fn() },
}));

vi.mock("../src/logger", () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let dir: string;
let cursorPath: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "resend-sync-runcycle-"));
	cursorPath = join(dir, "cursor.json");
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const noopBucket: TokenBucket = {
	take: async () => undefined,
	honorRetryAfter: async () => undefined,
};

function scriptedInternal(
	rows: Array<{ id: string; nextCursor: string }>,
	finalCursor: string,
): InternalApiClient {
	let i = 0;
	return async () => {
		if (i < rows.length) {
			const r = rows[i];
			i++;
			return {
				kind: "ok",
				body: {
					user: {
						id: r.id,
						email: `${r.id}@example.com`,
						name: r.id,
						phone: null,
					},
					nextCursor: r.nextCursor,
				},
			};
		}
		return {
			kind: "ok",
			body: { user: null, nextCursor: finalCursor },
		};
	};
}

describe("runCycle", () => {
	it("drains every available row and advances the cursor", async () => {
		const internal = scriptedInternal(
			[
				{ id: "a", nextCursor: "c-a" },
				{ id: "b", nextCursor: "c-b" },
				{ id: "c", nextCursor: "c-c" },
			],
			"c-c",
		);
		const resend: ResendUpsert = vi.fn(async () => ({ kind: "ok" }));

		const processed = await runCycle({
			internal,
			resend,
			bucket: noopBucket,
			cursorPath,
		});

		expect(processed).toBe(3);
		expect(resend).toHaveBeenCalledTimes(3);
		expect((await readCursorFile(cursorPath)).cursor).toBe("c-c");
	});

	it("stops at the first stall and preserves the cursor", async () => {
		let call = 0;
		const internal: InternalApiClient = async () => {
			call++;
			if (call === 1) {
				return {
					kind: "ok",
					body: {
						user: {
							id: "a",
							email: "a@example.com",
							name: "A",
							phone: null,
						},
						nextCursor: "c-a",
					},
				};
			}
			return {
				kind: "server-error",
				status: 503,
				message: "down",
				retryAfterMs: null,
			};
		};

		const resend: ResendUpsert = vi.fn(async () => ({ kind: "ok" }));
		const processed = await runCycle({
			internal,
			resend,
			bucket: noopBucket,
			cursorPath,
		});

		expect(processed).toBe(1);
		expect((await readCursorFile(cursorPath)).cursor).toBe("c-a");
	});

	it("observes the abort signal between rows", async () => {
		const controller = new AbortController();
		let call = 0;
		const internal: InternalApiClient = async () => {
			call++;
			return {
				kind: "ok",
				body: {
					user: {
						id: `u${call}`,
						email: `u${call}@example.com`,
						name: `U${call}`,
						phone: null,
					},
					nextCursor: `c-${call}`,
				},
			};
		};
		const resend: ResendUpsert = vi.fn(async () => {
			controller.abort();
			return { kind: "ok" };
		});

		const processed = await runCycle({
			internal,
			resend,
			bucket: noopBucket,
			cursorPath,
			signal: controller.signal,
		});

		// The in-flight row commits even though the signal aborts during it; the
		// loop exits after observing the abort, so processed === 1.
		expect(processed).toBe(1);
		expect((await readCursorFile(cursorPath)).cursor).toBe("c-1");
	});
});
