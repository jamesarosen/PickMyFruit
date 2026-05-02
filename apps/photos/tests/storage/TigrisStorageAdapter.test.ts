import { describe, it, expect, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { TigrisStorageAdapter } from "../../src/storage/TigrisStorageAdapter.js";

// These tests require a running LocalStack (or real Tigris) endpoint.
// They are skipped in CI unless the AWS_ACCESS_KEY_ID env var is set.
// The full LocalStack harness arrives in commit 7.
const hasS3Credentials = Boolean(process.env["AWS_ACCESS_KEY_ID"]);

describe.skipIf(!hasS3Credentials)(
	"TigrisStorageAdapter (requires LocalStack)",
	() => {
		let adapter: TigrisStorageAdapter;
		const testBucket = process.env["TEST_BUCKET"] ?? "pmf-photos-test";
		const testEndpoint =
			process.env["AWS_ENDPOINT_URL_S3"] ?? "http://localhost:4566";

		beforeEach(() => {
			adapter = new TigrisStorageAdapter({
				bucketName: testBucket,
				accessKeyId: process.env["AWS_ACCESS_KEY_ID"] ?? "",
				secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] ?? "",
				endpointUrl: testEndpoint,
			});
		});

		it("head returns exists=false for an object that does not exist", async () => {
			const key = `pub/nonexistent-${Date.now()}.jpg`;
			const result = await adapter.head(key);
			expect(result.exists).toBe(false);
		});

		it("put stores an object and head returns exists=true with metadata", async () => {
			const key = `pub/test-${Date.now()}.jpg`;
			const content = Buffer.from("fake jpeg bytes");
			const body = Readable.from(content);

			const putResult = await adapter.put(key, body, "image/jpeg");
			expect(typeof putResult.etag).toBe("string");
			expect(putResult.etag).toBeTruthy();

			const headResult = await adapter.head(key);
			expect(headResult.exists).toBe(true);
			expect(headResult.size).toBe(content.length);
		});

		it("delete removes an object so head returns exists=false", async () => {
			const key = `pub/to-delete-${Date.now()}.jpg`;
			await adapter.put(key, Readable.from(Buffer.from("data")), "image/jpeg");

			await adapter.delete(key);

			const result = await adapter.head(key);
			expect(result.exists).toBe(false);
		});

		it("delete is a no-op for a nonexistent key", async () => {
			const key = `pub/never-existed-${Date.now()}.jpg`;
			await expect(adapter.delete(key)).resolves.toBeUndefined();
		});
	},
);
