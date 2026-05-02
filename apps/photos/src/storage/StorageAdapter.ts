import type { Readable } from "node:stream";

/** Result of a HEAD check against the backing store. */
export interface HeadResult {
	exists: boolean;
	/** ETag from the object store, absent when the object does not exist. */
	etag?: string;
	/** Object size in bytes, absent when the object does not exist. */
	size?: number;
}

/** Result of a successful PUT. */
export interface PutResult {
	/** ETag assigned by the object store. */
	etag: string;
}

/**
 * Minimal storage operations needed by the photo service.
 *
 * Keys are opaque strings; the caller constructs them (e.g. `pub/{photoID}.jpg`).
 * The adapter makes no assumptions about key structure.
 */
export interface StorageAdapter {
	/** Check whether an object exists, returning its metadata if so. */
	head(key: string): Promise<HeadResult>;

	/** Write a streaming body to the given key, returning the stored object's ETag. */
	put(key: string, body: Readable, contentType: string): Promise<PutResult>;

	/** Delete an object. No-ops silently if the object does not exist. */
	delete(key: string): Promise<void>;
}
