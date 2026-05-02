import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type {
	StorageAdapter,
	HeadResult,
	PutResult,
} from "./StorageAdapter.js";

interface StoredObject {
	data: Buffer;
	contentType: string;
	etag: string;
}

/**
 * In-memory StorageAdapter backed by a plain Map.
 *
 * Intended for Vitest unit/acceptance tests only — data is lost when the
 * process exits. No network calls, no fixtures to clean up.
 */
export class MemoryStorageAdapter implements StorageAdapter {
	private readonly store = new Map<string, StoredObject>();

	async head(key: string): Promise<HeadResult> {
		const obj = this.store.get(key);
		if (!obj) {
			return { exists: false };
		}
		return { exists: true, etag: obj.etag, size: obj.data.length };
	}

	async put(
		key: string,
		body: Readable,
		contentType: string,
	): Promise<PutResult> {
		const chunks: Buffer[] = [];
		for await (const chunk of body) {
			chunks.push(
				Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string),
			);
		}
		const data = Buffer.concat(chunks);
		// Use an MD5 hash as a deterministic ETag, matching S3's convention for
		// non-multipart uploads. This makes the Memory adapter behave consistently
		// with what Tigris returns, so callers can compare ETags across adapters.
		const etag = `"${createHash("md5").update(data).digest("hex")}"`;
		this.store.set(key, { data, contentType, etag });
		return { etag };
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}
