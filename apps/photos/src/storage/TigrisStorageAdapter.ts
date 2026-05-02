import type { Readable } from "node:stream";
import {
	S3Client,
	HeadObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	NoSuchKey,
	NotFound,
} from "@aws-sdk/client-s3";
import type {
	StorageAdapter,
	HeadResult,
	PutResult,
} from "./StorageAdapter.js";

interface TigrisStorageAdapterOptions {
	bucketName: string;
	accessKeyId: string;
	secretAccessKey: string;
	endpointUrl: string;
}

/**
 * StorageAdapter backed by Tigris (S3-compatible object storage).
 *
 * Reads bucket name and endpoint from the options supplied at construction time;
 * callers should source these from validated env vars. The `requestChecksumCalculation`
 * option is set to `"WHEN_REQUIRED"` to avoid the AWS SDK v3 default of
 * `"WHEN_SUPPORTED"`, which requires `x-amz-decoded-content-length` on streaming
 * bodies that pipe()-based streams cannot supply.
 */
export class TigrisStorageAdapter implements StorageAdapter {
	private readonly client: S3Client;
	private readonly bucket: string;

	constructor(opts: TigrisStorageAdapterOptions) {
		this.bucket = opts.bucketName;
		this.client = new S3Client({
			region: "auto",
			endpoint: opts.endpointUrl,
			// Default changed to WHEN_SUPPORTED in SDK v3 — streaming bodies then require
			// x-amz-decoded-content-length, which is undefined for pipe()-based streams.
			requestChecksumCalculation: "WHEN_REQUIRED",
			credentials: {
				accessKeyId: opts.accessKeyId,
				secretAccessKey: opts.secretAccessKey,
			},
		});
	}

	async head(key: string): Promise<HeadResult> {
		try {
			const response = await this.client.send(
				new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
			);
			return {
				exists: true,
				etag: response.ETag,
				size: response.ContentLength,
			};
		} catch (err) {
			// S3 throws NoSuchKey or a NotFound (404) for a missing object on HEAD.
			if (err instanceof NoSuchKey || err instanceof NotFound) {
				return { exists: false };
			}
			// Status-code-based check for S3-compatible stores that may not throw
			// the typed error classes (e.g. LocalStack with older behaviour).
			if (
				typeof err === "object" &&
				err !== null &&
				"$metadata" in err &&
				(err as { $metadata: { httpStatusCode?: number } }).$metadata
					.httpStatusCode === 404
			) {
				return { exists: false };
			}
			throw err;
		}
	}

	async put(
		key: string,
		body: Readable,
		contentType: string,
		contentLength: number,
	): Promise<PutResult> {
		const response = await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
				ContentLength: contentLength,
			}),
		);
		const etag = response.ETag;
		if (!etag) {
			throw new Error(`S3 PutObject did not return an ETag for key: ${key}`);
		}
		return { etag };
	}

	async delete(key: string): Promise<void> {
		// S3's DeleteObject is idempotent — it returns 204 even for missing keys,
		// satisfying the "no-op silently" contract.
		await this.client.send(
			new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
		);
	}
}
