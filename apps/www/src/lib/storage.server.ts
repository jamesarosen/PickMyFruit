import { createReadStream, createWriteStream } from 'node:fs'
import { readFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
	S3Client,
	GetObjectCommand,
	DeleteObjectCommand,
	type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { Sentry } from '@/lib/sentry'
import { serverEnv } from '@/lib/env.server'

/**
 * Storage uploads always take a stream — buffering happens (if at all) at the
 * call site, never inside the adapter, so peak memory is visible.
 */
export type StorageBody = Readable

const multipartUploadPartSize = 5 * 1024 * 1024

/**
 * Pass-through Transform that counts bytes flowing through it. Used to record
 * `storage.bytes_written` on upload spans without buffering or interfering
 * with downstream backpressure (a plain PassThrough with a 'data' listener
 * would flip the stream into flowing mode and break the consumer).
 */
function makeByteCounter(): { stream: Transform; bytes: () => number } {
	let count = 0
	const stream = new Transform({
		transform(chunk: Buffer, _enc, cb) {
			count += chunk.length
			cb(null, chunk)
		},
	})
	return { stream, bytes: () => count }
}

/** Optional metadata for the upload — used purely for tracing/observability. */
export interface UploadOptions {
	mimeType: string
	/** Optional image UUID, propagated to spans for cross-correlation. */
	photoId?: string
	/**
	 * Body length in bytes when known. `lib-storage`'s `Upload` falls back to
	 * a single `PutObjectCommand` for bodies smaller than `partSize`; without
	 * a `Content-Length` header that PutObject goes out chunked-encoded, which
	 * Tigris rejects with `MissingContentLength`. Set this whenever the size
	 * can be determined ahead of time (file `stat`, buffered output, …).
	 */
	contentLength?: number
}

/** Contract for all storage backends. */
export interface StorageAdapter {
	/** Store a file. `raw` objects are private server-side only; `pub` objects are world-readable. */
	upload(
		dir: 'raw' | 'pub',
		pathWithinDir: string,
		body: StorageBody,
		opts: UploadOptions
	): Promise<void>
	/** Read a file server-side (intended for raw/private objects). */
	read(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Buffer>
	/** Stream a file server-side without buffering it in memory. */
	readStream(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Readable>
	/** Stream a file to an HTTP response without buffering it in memory. */
	readWebStream(
		dir: 'raw' | 'pub',
		pathWithinDir: string
	): Promise<ReadableStream>
	/** Return the public URL for a `pub/` object. */
	publicUrl(pathWithinDir: string): string
	/** Delete a stored object. No-ops silently if the object does not exist. */
	delete(dir: 'raw' | 'pub', pathWithinDir: string): Promise<void>
}

/** Local filesystem adapter — used in development and tests (STORAGE_PROVIDER=local). */
export class LocalStorageAdapter implements StorageAdapter {
	private readonly uploadsDir: string

	constructor(dataDir: string) {
		this.uploadsDir = resolve(dataDir, 'uploads')
	}

	/**
	 * Resolves dir + pathWithinDir to an absolute path, guarding against path traversal.
	 * Reports attempted traversals to Sentry before throwing.
	 */
	private safeFilePath(dir: 'raw' | 'pub', pathWithinDir: string): string {
		const filePath = resolve(this.uploadsDir, dir, pathWithinDir)
		if (!filePath.startsWith(this.uploadsDir + sep)) {
			const e = new Error('Storage: path traversal attempt blocked')
			e.cause = `${dir}/${pathWithinDir}`
			Sentry.captureException(e)
			throw new Error('Invalid storage key')
		}
		return filePath
	}

	async upload(
		dir: 'raw' | 'pub',
		pathWithinDir: string,
		body: StorageBody,
		opts: UploadOptions
	): Promise<void> {
		const filePath = this.safeFilePath(dir, pathWithinDir)
		const counter = makeByteCounter()
		await Sentry.startSpan(
			{
				name: 'storage.upload.local',
				op: 'storage.upload',
				attributes: {
					'storage.provider': 'local',
					'storage.dir': dir,
					'storage.key': `${dir}/${pathWithinDir}`,
					'storage.mime_type': opts.mimeType,
					'storage.streaming': true,
					'storage.target_path': filePath,
					...(opts.photoId ? { 'photo.id': opts.photoId } : {}),
				},
			},
			async (span) => {
				await mkdir(dirname(filePath), { recursive: true })
				await pipeline(body, counter.stream, createWriteStream(filePath))
				span.setAttribute('storage.bytes_written', counter.bytes())
			}
		)
	}

	async read(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Buffer> {
		return readFile(this.safeFilePath(dir, pathWithinDir))
	}

	async readStream(
		dir: 'raw' | 'pub',
		pathWithinDir: string
	): Promise<Readable> {
		return createReadStream(this.safeFilePath(dir, pathWithinDir))
	}

	async readWebStream(
		dir: 'raw' | 'pub',
		pathWithinDir: string
	): Promise<ReadableStream> {
		const stream = await this.readStream(dir, pathWithinDir)
		return Readable.toWeb(stream) as ReadableStream
	}

	publicUrl(pathWithinDir: string): string {
		return `/api/uploads/pub/${pathWithinDir}`
	}

	async delete(dir: 'raw' | 'pub', pathWithinDir: string): Promise<void> {
		await rm(this.safeFilePath(dir, pathWithinDir), { force: true })
	}
}

/** Tigris (S3-compatible) adapter — required in production (STORAGE_PROVIDER=tigris). */
export class TigrisStorageAdapter implements StorageAdapter {
	private readonly client: S3Client
	private readonly bucket: string

	constructor(opts: {
		bucketName: string
		accessKeyId: string
		secretAccessKey: string
		endpointUrl: string
	}) {
		this.bucket = opts.bucketName
		this.client = new S3Client({
			region: 'auto',
			endpoint: opts.endpointUrl,
			// Default changed to WHEN_SUPPORTED in SDK v3 — streaming bodies then require
			// x-amz-decoded-content-length, which is undefined for pipe()-based streams.
			requestChecksumCalculation: 'WHEN_REQUIRED',
			credentials: {
				accessKeyId: opts.accessKeyId,
				secretAccessKey: opts.secretAccessKey,
			},
		})
	}

	async upload(
		dir: 'raw' | 'pub',
		pathWithinDir: string,
		body: StorageBody,
		opts: UploadOptions
	): Promise<void> {
		const key = `${dir}/${pathWithinDir}`
		const counter = makeByteCounter()
		const params: PutObjectCommandInput = {
			Bucket: this.bucket,
			Key: key,
			Body: counter.stream,
			ContentType: opts.mimeType,
			...(opts.contentLength !== undefined
				? { ContentLength: opts.contentLength }
				: {}),
			...(dir === 'pub' ? { ACL: 'public-read' } : {}),
		}
		await Sentry.startSpan(
			{
				name: 'storage.upload.tigris',
				op: 'storage.upload',
				attributes: {
					'storage.provider': 'tigris',
					'storage.dir': dir,
					'storage.key': key,
					'storage.bucket': this.bucket,
					'storage.mime_type': opts.mimeType,
					'storage.streaming': true,
					'storage.upload_strategy': 'multipart',
					'storage.part_size_bytes': multipartUploadPartSize,
					'storage.queue_size': 1,
					'storage.acl': dir === 'pub' ? 'public-read' : 'private',
					...(opts.contentLength !== undefined
						? { 'storage.content_length': opts.contentLength }
						: {}),
					...(opts.photoId ? { 'photo.id': opts.photoId } : {}),
				},
			},
			async (span) => {
				// pipeline (not body.pipe) so a source-stream error destroys
				// counter.stream — Upload then sees the error and rejects, instead
				// of completing with a truncated-but-valid object.
				const piped = pipeline(body, counter.stream)
				const upload = new Upload({
					client: this.client,
					params,
					queueSize: 1,
					partSize: multipartUploadPartSize,
				}).done()
				const [, result] = await Promise.all([piped, upload])
				span.setAttribute('storage.bytes_written', counter.bytes())
				if ('ETag' in result && result.ETag) {
					span.setAttribute('storage.etag', result.ETag)
				}
			}
		)
	}

	async read(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Buffer> {
		const response = await this.client.send(
			new GetObjectCommand({ Bucket: this.bucket, Key: `${dir}/${pathWithinDir}` })
		)
		if (!response.Body) {
			throw new Error(`Empty body for key: ${dir}/${pathWithinDir}`)
		}
		return Buffer.from(await response.Body.transformToByteArray())
	}

	async readStream(
		dir: 'raw' | 'pub',
		pathWithinDir: string
	): Promise<Readable> {
		const response = await this.client.send(
			new GetObjectCommand({ Bucket: this.bucket, Key: `${dir}/${pathWithinDir}` })
		)
		if (!response.Body) {
			throw new Error(`Empty body for key: ${dir}/${pathWithinDir}`)
		}
		return response.Body instanceof Readable
			? response.Body
			: Readable.fromWeb(
					response.Body.transformToWebStream() as unknown as import('node:stream/web').ReadableStream
				)
	}

	async readWebStream(
		dir: 'raw' | 'pub',
		pathWithinDir: string
	): Promise<ReadableStream> {
		const stream = await this.readStream(dir, pathWithinDir)
		return Readable.toWeb(stream) as ReadableStream
	}

	publicUrl(pathWithinDir: string): string {
		return `https://${this.bucket}.fly.storage.tigris.dev/pub/${pathWithinDir}`
	}

	async delete(dir: 'raw' | 'pub', pathWithinDir: string): Promise<void> {
		// S3's DeleteObject is idempotent — it returns 204 even for missing keys,
		// satisfying the "no-op silently" contract. (Note: this behaviour may change
		// if versioning or object lock is enabled on the bucket.)
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: this.bucket,
				Key: `${dir}/${pathWithinDir}`,
			})
		)
	}
}

/** Instantiate the appropriate adapter based on STORAGE_PROVIDER. */
export function createStorageAdapter(env: typeof serverEnv): StorageAdapter {
	if (env.storage.PROVIDER === 'local') {
		return new LocalStorageAdapter(env.storage.DATA_DIR)
	}
	return new TigrisStorageAdapter({
		bucketName: env.storage.BUCKET_NAME,
		accessKeyId: env.storage.AWS_ACCESS_KEY_ID,
		secretAccessKey: env.storage.AWS_SECRET_ACCESS_KEY,
		endpointUrl: env.storage.AWS_ENDPOINT_URL_S3,
	})
}

/** Singleton — import this in route handlers and server functions. */
export const storage: StorageAdapter = createStorageAdapter(serverEnv)
