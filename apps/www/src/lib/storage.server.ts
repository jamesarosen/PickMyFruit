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
	/**
	 * Return the public URL for a `pub/` object.
	 * @throws {TypeError} When the implementation cannot build a valid URL (e.g. invalid `mediaOrigin` or pathname on Tigris).
	 */
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
		// @TODO Restore the file extension once nitrojs/nitro#4252 is fixed.
		// Nitro 3.0.260429-beta's dev server intercepts URLs with image
		// extensions before route handlers run, so `/api/uploads/pub/<id>.jpg`
		// 404s with a bare `default-src 'none'` CSP. Stripping the extension
		// here is a workaround; the route in `routes/api/uploads/$.ts`
		// re-appends `.jpg` when reading from disk. Once Nitro routes
		// extensioned paths to dynamic handlers again, drop the strip and the
		// re-append so the URL on the wire matches the on-disk filename and
		// browsers/CDNs can rely on the extension for caching/MIME inference.
		// https://github.com/nitrojs/nitro/issues/4252
		const withoutExt = pathWithinDir.replace(/\.(jpe?g|png|webp)$/i, '')
		return `/api/uploads/pub/${withoutExt}`
	}

	async delete(dir: 'raw' | 'pub', pathWithinDir: string): Promise<void> {
		await rm(this.safeFilePath(dir, pathWithinDir), { force: true })
	}
}

/** Tigris (S3-compatible) adapter — required in production (STORAGE_PROVIDER=tigris). */
export class TigrisStorageAdapter implements StorageAdapter {
	private readonly client: S3Client
	private readonly bucket: string
	private readonly mediaOrigin: string

	constructor(opts: {
		bucketName: string
		accessKeyId: string
		secretAccessKey: string
		endpointUrl: string
		/** Origin for `publicUrl` (e.g. custom CDN or default `https://{bucket}.fly.storage.tigris.dev`). */
		mediaOrigin: string
	}) {
		this.bucket = opts.bucketName
		this.mediaOrigin = opts.mediaOrigin
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

	/**
	 * Builds an absolute URL under `pub/` with per-segment encoding.
	 * @throws {TypeError} When `mediaOrigin` is not a valid base URL for `new URL()`, or the composed pathname is invalid.
	 */
	publicUrl(pathWithinDir: string): string {
		const u = new URL(this.mediaOrigin)
		const encoded = pathWithinDir
			.split('/')
			.filter((s) => s.length > 0)
			.map((s) => encodeURIComponent(s))
			.join('/')
		const basePath = u.pathname.replace(/\/+$/, '')
		u.pathname = `${basePath}/pub/${encoded}`.replace(/\/{2,}/g, '/')
		return u.href
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
		mediaOrigin: env.storage.mediaOrigin,
	})
}

/** Singleton — import this in route handlers and server functions. */
export const storage: StorageAdapter = createStorageAdapter(serverEnv)
