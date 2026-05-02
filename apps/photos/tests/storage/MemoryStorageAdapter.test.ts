import { describe, it, expect, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { MemoryStorageAdapter } from "../../src/storage/MemoryStorageAdapter.js";

describe("MemoryStorageAdapter", () => {
	let adapter: MemoryStorageAdapter;

	beforeEach(() => {
		adapter = new MemoryStorageAdapter();
	});

	describe("head", () => {
		it("returns exists=false for a key that has not been stored", async () => {
			const result = await adapter.head("pub/missing.jpg");
			expect(result.exists).toBe(false);
			expect(result.etag).toBeUndefined();
			expect(result.size).toBeUndefined();
		});

		it("returns exists=true with etag and size after a put", async () => {
			const body = Readable.from(Buffer.from("hello world"));
			await adapter.put("pub/hello.jpg", body, "image/jpeg");

			const result = await adapter.head("pub/hello.jpg");
			expect(result.exists).toBe(true);
			expect(typeof result.etag).toBe("string");
			expect(result.etag).toBeTruthy();
			expect(result.size).toBe(11); // "hello world" is 11 bytes
		});
	});

	describe("put", () => {
		it("stores the body and returns an etag", async () => {
			const content = "image bytes here";
			const body = Readable.from(Buffer.from(content));

			const result = await adapter.put("pub/photo.jpg", body, "image/jpeg");

			expect(typeof result.etag).toBe("string");
			expect(result.etag).toBeTruthy();
		});

		it("overwrites an existing key with new content", async () => {
			const first = Readable.from(Buffer.from("first"));
			await adapter.put("pub/photo.jpg", first, "image/jpeg");

			const second = Readable.from(Buffer.from("second content"));
			await adapter.put("pub/photo.jpg", second, "image/jpeg");

			const result = await adapter.head("pub/photo.jpg");
			expect(result.size).toBe(14); // "second content" is 14 bytes
		});

		it("stores distinct content for distinct keys", async () => {
			await adapter.put(
				"pub/a.jpg",
				Readable.from(Buffer.from("aaa")),
				"image/jpeg",
			);
			await adapter.put(
				"pub/b.jpg",
				Readable.from(Buffer.from("bbbbb")),
				"image/jpeg",
			);

			const a = await adapter.head("pub/a.jpg");
			const b = await adapter.head("pub/b.jpg");
			expect(a.size).toBe(3);
			expect(b.size).toBe(5);
		});
	});

	describe("delete", () => {
		it("removes a stored key so head returns exists=false", async () => {
			await adapter.put(
				"pub/photo.jpg",
				Readable.from(Buffer.from("data")),
				"image/jpeg",
			);
			await adapter.delete("pub/photo.jpg");

			const result = await adapter.head("pub/photo.jpg");
			expect(result.exists).toBe(false);
		});

		it("is a no-op when the key does not exist", async () => {
			// Should resolve without throwing
			await expect(
				adapter.delete("pub/nonexistent.jpg"),
			).resolves.toBeUndefined();
		});
	});
});
