import { v7 as uuidv7 } from 'uuid'
import { detectFromBuffer } from 'mime-bytes'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { UserError } from '@/lib/user-error'

export const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024

const MIME_TO_EXT = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
} as const

export type ALLOWED_EXT = (typeof MIME_TO_EXT)[keyof typeof MIME_TO_EXT]

/**
 * Cap on uploads in flight (running + queued). Past this we shed load with a
 * 503 instead of holding more 5 MB temp files and pixel buffers around.
 */
export const MAX_UPLOAD_QUEUE_DEPTH = 4

let queueDepth = 0

/** Synchronous capacity check — call before staging the request body to disk. */
export function assertPhotoUploadCapacity(): void {
	if (queueDepth >= MAX_UPLOAD_QUEUE_DEPTH) {
		throw new UserError(
			'SERVER_BUSY',
			'The server is busy processing other photo uploads. Please try again in a moment.',
			503
		)
	}
}

/** @internal Used by listing-photo-sharp-pipeline.server.ts to manage the shared queue. */
export function getQueueDepth(): number {
	return queueDepth
}

/** @internal */
export function incrementQueueDepth(): void {
	queueDepth++
}

/** @internal */
export function decrementQueueDepth(): void {
	queueDepth--
}

/**
 * Validates that a buffer is an allowed image type and within the size limit.
 * Detects the actual MIME type from magic bytes — the client-supplied Content-Type
 * is intentionally ignored.
 * Returns the narrowed MIME type on success; throws a UserError on failure.
 *
 * iPhone users frequently have HEIC files — the error message tells them to
 * convert rather than leaving them confused.
 */
export async function validatePhotoFile(
	buffer: Buffer
): Promise<AllowedMimeType> {
	const detected = await detectFromBuffer(buffer)
	const mimeType = detected?.mimeType ?? 'application/octet-stream'
	if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
		throw new UserError(
			'INVALID_MIME_TYPE',
			'Only JPEG, PNG, and WebP images are allowed. iPhone HEIC photos must be converted first.'
		)
	}
	if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
		throw new UserError(
			'FILE_TOO_LARGE',
			`Photo must be ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB or smaller`
		)
	}
	return mimeType as AllowedMimeType
}

/** Returns the file extension for an allowed MIME type. */
export function mimeToExt(mimeType: AllowedMimeType): ALLOWED_EXT {
	return MIME_TO_EXT[mimeType]
}

/**
 * Streams an upload to a unique temp file and returns its path. Buffering the
 * upload in memory (`Buffer.from(await file.arrayBuffer())`) was the dominant
 * peak-RSS contributor on the 256 MB Fly VM — staging to disk lets the request
 * body, the raw archive copy, and the photos-service stream each consume the
 * bytes via independent streams.
 */
export async function stageUploadStream(
	webStream: ReadableStream<Uint8Array>
): Promise<string> {
	const tempPath = join(tmpdir(), `pmf-upload-${uuidv7()}`)
	// Cast bridges DOM's ReadableStream and node:stream/web's, which differ in
	// their type defs even though Node accepts both at runtime.
	await pipeline(
		Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]),
		createWriteStream(tempPath)
	)
	return tempPath
}

/** Reads the first 4 KB of a staged upload and validates magic bytes. */
export async function detectMimeFromTempFile(
	tempPath: string
): Promise<AllowedMimeType> {
	const fd = await open(tempPath)
	try {
		const { buffer, bytesRead } = await fd.read(Buffer.alloc(4096), 0, 4096, 0)
		return validatePhotoFile(buffer.subarray(0, bytesRead))
	} finally {
		await fd.close()
	}
}

/** Best-effort cleanup of a staged temp file; never throws. */
export async function unlinkUploadStaging(tempPath: string): Promise<void> {
	await unlink(tempPath).catch(() => undefined)
}

/** Creates a Node.js read stream for a staged upload temp file. */
export function createStagedReadStream(tempPath: string): Readable {
	return createReadStream(tempPath)
}

/** Returns the byte size of a staged upload temp file. */
export async function getStagedFileSize(tempPath: string): Promise<number> {
	return (await stat(tempPath)).size
}
