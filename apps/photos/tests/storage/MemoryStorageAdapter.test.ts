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
			await adapter.put("pub/hello.jpg", body, "image/jpeg", 11);

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
			const buf = Buffer.from(content);
			const body = Readable.from(buf);

			const result = await adapter.put(
				"pub/photo.jpg",
				body,
				"image/jpeg",
				buf.length,
			);

			expect(typeof result.etag).toBe("string");
			expect(result.etag).toBeTruthy();
		});

		it("stores Uint8Array chunks byte-for-byte without corruption", async () => {
			// Uint8Array is not a Buffer, so the old `Buffer.isBuffer` guard would
			// fall through to Buffer.from(chunk as string), stringifying the array
			// as "16,32,0,…" and corrupting the stored bytes. Wrap in an array so
			// Readable.from emits the Uint8Array as a single chunk (matching how
			// sharp and other image pipelines deliver typed-array chunks).
			const input = new Uint8Array([0x10, 0x20, 0x00, 0xff, 0x80]);
			const body = Readable.from([input]);

			await adapter.put("pub/uint8.bin", body, "application/octet-stream", 5);

			const result = await adapter.head("pub/uint8.bin");
			expect(result.size).toBe(5);
		});

		it("overwrites an existing key with new content", async () => {
			const first = Buffer.from("first");
			await adapter.put(
				"pub/photo.jpg",
				Readable.from(first),
				"image/jpeg",
				first.length,
			);

			const second = Buffer.from("second content");
			await adapter.put(
				"pub/photo.jpg",
				Readable.from(second),
				"image/jpeg",
				second.length,
			);

			const result = await adapter.head("pub/photo.jpg");
			expect(result.size).toBe(14); // "second content" is 14 bytes
		});

		it("stores distinct content for distinct keys", async () => {
			const bufA = Buffer.from("aaa");
			const bufB = Buffer.from("bbbbb");
			await adapter.put(
				"pub/a.jpg",
				Readable.from(bufA),
				"image/jpeg",
				bufA.length,
			);
			await adapter.put(
				"pub/b.jpg",
				Readable.from(bufB),
				"image/jpeg",
				bufB.length,
			);

			const a = await adapter.head("pub/a.jpg");
			const b = await adapter.head("pub/b.jpg");
			expect(a.size).toBe(3);
			expect(b.size).toBe(5);
		});
	});

	describe("delete", () => {
		it("removes a stored key so head returns exists=false", async () => {
			const data = Buffer.from("data");
			await adapter.put(
				"pub/photo.jpg",
				Readable.from(data),
				"image/jpeg",
				data.length,
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
