import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import {
	LocalStorageAdapter,
	TigrisStorageAdapter,
} from '../src/lib/storage.server'

describe(LocalStorageAdapter, () => {
	let tmpDir: string
	let adapter: LocalStorageAdapter

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), 'pmf-storage-test-'))
		adapter = new LocalStorageAdapter(tmpDir)
	})

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true })
	})

	describe('upload + publicUrl (public access)', () => {
		it('writes the file and returns a /api/uploads/ URL', async () => {
			const buf = Buffer.from('fake-image-data')
			await adapter.upload('pub', 'listings/1/test.png', buf, {
				mimeType: 'image/png',
			})

			const url = adapter.publicUrl('listings/1/test.png')
			expect(url).toBe('/api/uploads/pub/listings/1/test.png')

			// File is actually on disk
			const written = await readFile(
				join(tmpDir, 'uploads', 'pub', 'listings/1/test.png')
			)
			expect(written).toEqual(buf)
		})

		it('creates nested directories as needed', async () => {
			await adapter.upload('pub', 'listings/99/deep/uuid.jpg', Buffer.from('x'), {
				mimeType: 'image/jpeg',
			})
			const written = await readFile(
				join(tmpDir, 'uploads', 'pub', 'listings/99/deep/uuid.jpg')
			)
			expect(written).toEqual(Buffer.from('x'))
		})

		it('pipes stream uploads to disk', async () => {
			await adapter.upload(
				'pub',
				'listings/1/streamed.jpg',
				Readable.from(['streamed-', 'image']),
				{ mimeType: 'image/jpeg' }
			)

			const written = await readFile(
				join(tmpDir, 'uploads', 'pub', 'listings/1/streamed.jpg'),
				'utf8'
			)
			expect(written).toBe('streamed-image')
		})
	})

	describe('upload + read (private access)', () => {
		it('writes the file and read returns the original buffer', async () => {
			const buf = Buffer.from('raw-image-with-exif')
			await adapter.upload('raw', 'listings/1/test.png', buf, {
				mimeType: 'image/png',
			})

			const result = await adapter.read('raw', 'listings/1/test.png')
			expect(result).toEqual(buf)
		})

		it('readStream returns a readable stream for an object', async () => {
			await adapter.upload('raw', 'listings/1/test.png', Buffer.from('raw'), {
				mimeType: 'image/png',
			})

			await expect(
				text(await adapter.readStream('raw', 'listings/1/test.png'))
			).resolves.toBe('raw')
		})

		it('readWebStream returns a response body stream without buffering through read()', async () => {
			await adapter.upload('pub', 'listings/1/test.jpg', Buffer.from('public'), {
				mimeType: 'image/jpeg',
			})

			const readSpy = vi.spyOn(adapter, 'read')
			const response = new Response(
				await adapter.readWebStream('pub', 'listings/1/test.jpg')
			)

			expect(await response.text()).toBe('public')
			expect(readSpy).not.toHaveBeenCalled()
		})
	})

	describe('read (missing file)', () => {
		it('throws with ENOENT code when file does not exist', async () => {
			await expect(
				adapter.read('pub', 'listings/1/missing.png')
			).rejects.toMatchObject({
				code: 'ENOENT',
			})
		})
	})

	describe('delete', () => {
		it('removes the file so subsequent read throws', async () => {
			await adapter.upload(
				'pub',
				'listings/1/delete-me.png',
				Buffer.from('data'),
				{
					mimeType: 'image/png',
				}
			)
			await adapter.delete('pub', 'listings/1/delete-me.png')
			await expect(
				adapter.read('pub', 'listings/1/delete-me.png')
			).rejects.toThrow()
		})

		it('does not throw when the file does not exist', async () => {
			await expect(
				adapter.delete('pub', 'listings/1/nonexistent.png')
			).resolves.not.toThrow()
		})
	})

	describe('path traversal', () => {
		it('upload rejects traversal in pathWithinDir', async () => {
			await expect(
				adapter.upload('pub', '../../../etc/passwd', Buffer.from('x'), {
					mimeType: 'text/plain',
				})
			).rejects.toThrow('Invalid storage key')
		})

		it('read rejects traversal in pathWithinDir', async () => {
			await expect(adapter.read('pub', '../../../etc/passwd')).rejects.toThrow(
				'Invalid storage key'
			)
		})

		it('delete rejects traversal in pathWithinDir', async () => {
			await expect(adapter.delete('pub', '../../../etc/passwd')).rejects.toThrow(
				'Invalid storage key'
			)
		})
	})
})

describe(TigrisStorageAdapter, () => {
	const adapter = new TigrisStorageAdapter({
		bucketName: 'test-bucket',
		accessKeyId: 'fake',
		secretAccessKey: 'fake',
		endpointUrl: 'https://fly.storage.tigris.dev',
	})

	describe('publicUrl', () => {
		it('returns the CDN URL for a pub/ path', () => {
			expect(adapter.publicUrl('listings/1/uuid.jpg')).toBe(
				'https://test-bucket.fly.storage.tigris.dev/pub/listings/1/uuid.jpg'
			)
		})
	})

	describe('upload', () => {
		it('uploads a Readable stream without throwing x-amz-decoded-content-length error', async () => {
			// Regression: AWS SDK v3 defaults to WHEN_SUPPORTED for requestChecksumCalculation,
			// which requires x-amz-decoded-content-length for streaming bodies. That header is
			// undefined for pipe()-based streams, causing a TypeError in Node's setHeader.
			// requestChecksumCalculation: 'WHEN_REQUIRED' on the S3Client fixes this.
			const server = createServer((req, res) => {
				req.resume()
				req.on('end', () => {
					res.writeHead(200)
					res.end()
				})
			})
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
			const { port } = server.address() as AddressInfo
			const localAdapter = new TigrisStorageAdapter({
				bucketName: 'test-bucket',
				accessKeyId: 'fake',
				secretAccessKey: 'fake',
				endpointUrl: `http://127.0.0.1:${port}`,
			})

			try {
				const stream = Readable.from(Buffer.from('hello'))
				await expect(
					localAdapter.upload('raw', 'test/photo.jpg', stream, {
						mimeType: 'image/jpeg',
					})
				).resolves.toBeUndefined()
			} finally {
				await new Promise<void>((resolve, reject) =>
					server.close((err) => (err ? reject(err) : resolve()))
				)
			}
		})
	})
})
