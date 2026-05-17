import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EMPTY_CURSOR,
	readCursorFile,
	writeCursorFile,
} from "../src/cursor-file";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "resend-sync-cursor-"));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe("cursor-file", () => {
	it("round-trips a cursor through write → read", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "cursor.json");
			await writeCursorFile(
				path,
				"opaque-base64-cursor",
				() => 1_700_000_000_000,
			);
			const got = await readCursorFile(path);
			expect(got).toStrictEqual({
				cursor: "opaque-base64-cursor",
				updatedAt: 1_700_000_000_000,
			});
		});
		expect.hasAssertions();
	});

	it("returns EMPTY_CURSOR when the file does not exist", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "missing.json");
			await expect(readCursorFile(path)).resolves.toStrictEqual(EMPTY_CURSOR);
		});
		expect.hasAssertions();
	});

	it("returns EMPTY_CURSOR when the file is unparseable JSON", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "garbage.json");
			await writeFile(path, "{ not json", "utf8");
			await expect(readCursorFile(path)).resolves.toStrictEqual(EMPTY_CURSOR);
		});
		expect.hasAssertions();
	});

	it("returns EMPTY_CURSOR when the schema does not match", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "wrong-shape.json");
			await writeFile(path, JSON.stringify({ nope: 1 }), "utf8");
			await expect(readCursorFile(path)).resolves.toStrictEqual(EMPTY_CURSOR);
		});
		expect.hasAssertions();
	});

	it("creates missing parent directories on first write", async () => {
		await withTempDir(async (dir) => {
			const nested = join(dir, "a", "b", "cursor.json");
			await writeCursorFile(nested, "c1");
			const got = await readCursorFile(nested);
			expect(got.cursor).toBe("c1");
		});
		expect.hasAssertions();
	});

	it("does not leave a .tmp file behind on a successful write", async () => {
		await withTempDir(async (dir) => {
			const path = join(dir, "cursor.json");
			await writeCursorFile(path, "c1");
			const entries = await readdir(dir);
			expect(entries).toStrictEqual(["cursor.json"]);
		});
		expect.hasAssertions();
	});

	it("a crash mid-write leaves the previous cursor intact", async () => {
		await withTempDir(async (dir) => {
			// Simulate the failure mode: write a stale .tmp file but never rename it.
			// Reading the canonical path must still see the previous good cursor.
			const path = join(dir, "cursor.json");
			await writeCursorFile(path, "previous");
			await writeFile(`${path}.tmp`, "{ partial", "utf8");

			const got = await readCursorFile(path);
			expect(got.cursor).toBe("previous");

			// The partial .tmp does not poison readCursorFile because we never read it.
			const raw = await readFile(path, "utf8");
			expect(JSON.parse(raw).cursor).toBe("previous");
		});
		expect.hasAssertions();
	});
});
