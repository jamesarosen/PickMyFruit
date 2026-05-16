import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EMPTY_CURSOR,
	readCursorFile,
	writeCursorFile,
} from "../src/cursor-file";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "resend-sync-cursor-"));
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("cursor-file", () => {
	it("round-trips a cursor through write → read", async () => {
		const path = join(dir, "cursor.json");
		await writeCursorFile(
			path,
			"opaque-base64-cursor",
			() => 1_700_000_000_000,
		);
		const got = await readCursorFile(path);
		expect(got).toEqual({
			cursor: "opaque-base64-cursor",
			updatedAt: 1_700_000_000_000,
		});
	});

	it("returns EMPTY_CURSOR when the file does not exist", async () => {
		const path = join(dir, "missing.json");
		expect(await readCursorFile(path)).toEqual(EMPTY_CURSOR);
	});

	it("returns EMPTY_CURSOR when the file is unparseable JSON", async () => {
		const path = join(dir, "garbage.json");
		await writeFile(path, "{ not json", "utf8");
		expect(await readCursorFile(path)).toEqual(EMPTY_CURSOR);
	});

	it("returns EMPTY_CURSOR when the schema does not match", async () => {
		const path = join(dir, "wrong-shape.json");
		await writeFile(path, JSON.stringify({ nope: 1 }), "utf8");
		expect(await readCursorFile(path)).toEqual(EMPTY_CURSOR);
	});

	it("creates missing parent directories on first write", async () => {
		const nested = join(dir, "a", "b", "cursor.json");
		await writeCursorFile(nested, "c1");
		const got = await readCursorFile(nested);
		expect(got.cursor).toBe("c1");
	});

	it("does not leave a .tmp file behind on a successful write", async () => {
		const path = join(dir, "cursor.json");
		await writeCursorFile(path, "c1");
		const entries = await readdir(dir);
		expect(entries).toEqual(["cursor.json"]);
	});

	it("a crash mid-write leaves the previous cursor intact", async () => {
		// Simulate the failure mode: write a stale .tmp file but never rename it.
		// Reading the canonical path must still see the previous good cursor.
		const path = join(dir, "cursor.json");
		await writeCursorFile(path, "previous");
		await writeFile(`${path}.tmp`, "{ partial", "utf8");

		const got = await readCursorFile(path);
		expect(got.cursor).toBe("previous");

		// And the partial .tmp does not poison readCursorFile because we never read it.
		const raw = await readFile(path, "utf8");
		expect(JSON.parse(raw).cursor).toBe("previous");
	});
});
