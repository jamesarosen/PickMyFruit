import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processOneRow } from "../src/process-row";
import { writeCursorFile, readCursorFile } from "../src/cursor-file";
import type { InternalApiClient } from "../src/internal-api-client";
import type { ResendUpsert } from "../src/resend-client";
import type { TokenBucket } from "../src/token-bucket";

vi.mock(import("../src/sentry"), () => ({
	Sentry: { captureException: vi.fn() },
}));

vi.mock(import("../src/logger"), () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

async function withTempCursor(
	fn: (cursorPath: string) => Promise<void>,
): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "resend-sync-process-"));
	try {
		await fn(join(dir, "cursor.json"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function fakeBucket(): TokenBucket & {
	taken: number[];
	retryAfterCalls: number[];
} {
	const state = { taken: [] as number[], retryAfterCalls: [] as number[] };
	const bucket: TokenBucket = {
		async take(count) {
			state.taken.push(count);
		},
		async honorRetryAfter(ms) {
			state.retryAfterCalls.push(ms);
		},
	};
	return Object.assign(bucket, state);
}

function fakeInternal(
	scripts: Array<Awaited<ReturnType<InternalApiClient>>>,
): InternalApiClient & { calls: string[] } {
	let i = 0;
	const calls: string[] = [];
	const client: InternalApiClient = async (cursor) => {
		calls.push(cursor);
		const next = scripts[i] ?? scripts[scripts.length - 1];
		i++;
		return next;
	};
	return Object.assign(client, { calls });
}

describe(processOneRow, () => {
	it("upserts a user, writes cursor, returns processed", async () => {
		await withTempCursor(async (cursorPath) => {
			const internal = fakeInternal([
				{
					kind: "ok",
					body: {
						user: {
							id: "u1",
							email: "u@example.com",
							name: "You Sir",
						},
						nextCursor: "cursor-after-u1",
					},
				},
			]);
			const resend: ResendUpsert = vi.fn(async () => ({ kind: "ok" }));
			const bucket = fakeBucket();

			const out = await processOneRow({ internal, resend, bucket, cursorPath });
			expect(out).toBe("processed");
			expect(bucket.taken).toStrictEqual([2]);
			expect((await readCursorFile(cursorPath)).cursor).toBe("cursor-after-u1");
			expect(resend).toHaveBeenCalledWith({
				id: "u1",
				email: "u@example.com",
				name: "You Sir",
			});
		});
		expect.hasAssertions();
	});

	it("returns drained when API user is null and persists the echoed cursor", async () => {
		await withTempCursor(async (cursorPath) => {
			await writeCursorFile(cursorPath, "previous-cursor");
			const internal = fakeInternal([
				{ kind: "ok", body: { user: null, nextCursor: "previous-cursor" } },
			]);
			const resend: ResendUpsert = vi.fn();

			const out = await processOneRow({
				internal,
				resend,
				bucket: fakeBucket(),
				cursorPath,
			});
			expect(out).toBe("drained");
			expect(resend).not.toHaveBeenCalled();
			expect((await readCursorFile(cursorPath)).cursor).toBe("previous-cursor");
		});
		expect.hasAssertions();
	});

	it("advances past a Resend 4xx (permanent failure)", async () => {
		await withTempCursor(async (cursorPath) => {
			const internal = fakeInternal([
				{
					kind: "ok",
					body: {
						user: { id: "u-bad", email: "bad", name: "Bad Email" },
						nextCursor: "cursor-after-bad",
					},
				},
			]);
			const resend: ResendUpsert = vi.fn(async () => ({
				kind: "client-error",
				status: 422,
				message: "invalid email",
			}));

			const out = await processOneRow({
				internal,
				resend,
				bucket: fakeBucket(),
				cursorPath,
			});
			expect(out).toBe("processed");
			expect((await readCursorFile(cursorPath)).cursor).toBe(
				"cursor-after-bad",
			);
		});
		expect.hasAssertions();
	});

	it("stalls on Resend 5xx and honors Retry-After", async () => {
		await withTempCursor(async (cursorPath) => {
			const internal = fakeInternal([
				{
					kind: "ok",
					body: {
						user: {
							id: "u-flaky",
							email: "flaky@example.com",
							name: "Flaky",
						},
						nextCursor: "cursor-after-flaky",
					},
				},
			]);
			const resend: ResendUpsert = vi.fn(async () => ({
				kind: "server-error",
				status: 503,
				message: "down",
				retryAfterMs: 1_500,
			}));
			const bucket = fakeBucket();

			const out = await processOneRow({ internal, resend, bucket, cursorPath });
			expect(out).toBe("stalled");
			expect(bucket.retryAfterCalls).toStrictEqual([1_500]);
			// Cursor file must remain absent (no write yet).
			const cursor = await readFile(cursorPath, "utf8").catch(() => null);
			expect(cursor).toBeNull();
		});
		expect.hasAssertions();
	});

	it("stalls on upstream (internal API) 5xx without advancing cursor", async () => {
		await withTempCursor(async (cursorPath) => {
			await writeCursorFile(cursorPath, "before");
			const internal = fakeInternal([
				{
					kind: "server-error",
					status: 503,
					message: "db down",
					retryAfterMs: null,
				},
			]);
			const resend: ResendUpsert = vi.fn();

			const out = await processOneRow({
				internal,
				resend,
				bucket: fakeBucket(),
				cursorPath,
			});
			expect(out).toBe("stalled");
			expect(resend).not.toHaveBeenCalled();
			expect((await readCursorFile(cursorPath)).cursor).toBe("before");
		});
		expect.hasAssertions();
	});

	it("stalls on upstream network error", async () => {
		await withTempCursor(async (cursorPath) => {
			const internal: InternalApiClient = async () => ({
				kind: "network-error",
				error: new Error("ECONNREFUSED"),
			});
			const resend: ResendUpsert = vi.fn();

			const out = await processOneRow({
				internal,
				resend,
				bucket: fakeBucket(),
				cursorPath,
			});
			expect(out).toBe("stalled");
		});
		expect.hasAssertions();
	});
});
