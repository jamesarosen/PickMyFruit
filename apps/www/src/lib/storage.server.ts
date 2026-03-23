import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { Sentry } from '@/lib/sentry'
import { serverEnv } from '@/lib/env.server'

/** Contract for all storage backends. */
export interface StorageAdapter {
	/** Store a file. `raw` objects are private server-side only; `pub` objects are world-readable. */
	upload(
		dir: 'raw' | 'pub',
		pathWithinDir: string,
		buffer: Buffer,
		opts: { mimeType: string }
	): Promise<void>
	/** Read a file server-side (intended for raw/private objects). */
	read(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Buffer>
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
		buffer: Buffer,
		_opts: { mimeType: string }
	): Promise<void> {
		const filePath = this.safeFilePath(dir, pathWithinDir)
		await mkdir(dirname(filePath), { recursive: true })
		await writeFile(filePath, buffer)
	}

	async read(dir: 'raw' | 'pub', pathWithinDir: string): Promise<Buffer> {
		return readFile(this.safeFilePath(dir, pathWithinDir))
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
			credentials: {
				accessKeyId: opts.accessKeyId,
				secretAccessKey: opts.secretAccessKey,
			},
		})
	}

	async upload(
		dir: 'raw' | 'pub',
		pathWithinDir: string,
		buffer: Buffer,
		opts: { mimeType: string }
	): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.bucket,
				Key: `${dir}/${pathWithinDir}`,
				Body: buffer,
				ContentType: opts.mimeType,
				...(dir === 'pub' ? { ACL: 'public-read' } : {}),
			})
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
