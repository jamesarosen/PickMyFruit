import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import {
	MemoryStorageAdapter,
	TigrisStorageAdapter,
} from '../src/lib/storage.server'

describe(MemoryStorageAdapter, () => {
	let adapter: MemoryStorageAdapter

	beforeEach(() => {
		adapter = new MemoryStorageAdapter()
	})

	describe('upload + publicUrl (public access)', () => {
		it('stores the file and returns a /api/uploads/ URL', async () => {
			const buf = Buffer.from('fake-image-data')
			await adapter.upload('pub', 'listings/1/test.png', Readable.from(buf), {
				mimeType: 'image/png',
			})

			const url = adapter.publicUrl('listings/1/test.png')
			expect(url).toBe('/api/uploads/pub/listings/1/test.png')

			// Data is actually stored
			const stored = await adapter.read('pub', 'listings/1/test.png')
			expect(stored).toEqual(buf)
		})

		it('accepts nested paths without requiring directory creation', async () => {
			await adapter.upload(
				'pub',
				'listings/99/deep/uuid.jpg',
				Readable.from(Buffer.from('x')),
				{ mimeType: 'image/jpeg' }
			)
			const stored = await adapter.read('pub', 'listings/99/deep/uuid.jpg')
			expect(stored).toEqual(Buffer.from('x'))
		})

		it('assembles streamed upload chunks into a single buffer', async () => {
			await adapter.upload(
				'pub',
				'listings/1/streamed.jpg',
				Readable.from(['streamed-', 'image']),
				{ mimeType: 'image/jpeg' }
			)

			const stored = await adapter.read('pub', 'listings/1/streamed.jpg')
			expect(stored.toString('utf8')).toBe('streamed-image')
		})
	})

	describe('upload + read (private access)', () => {
		it('stores the file and read returns the original buffer', async () => {
			const buf = Buffer.from('raw-image-with-exif')
			await adapter.upload('raw', 'listings/1/test.png', Readable.from(buf), {
				mimeType: 'image/png',
			})

			const result = await adapter.read('raw', 'listings/1/test.png')
			expect(result).toEqual(buf)
		})

		it('readStream returns a readable stream for a stored object', async () => {
			await adapter.upload(
				'raw',
				'listings/1/test.png',
				Readable.from(Buffer.from('raw')),
				{ mimeType: 'image/png' }
			)

			await expect(
				text(await adapter.readStream('raw', 'listings/1/test.png'))
			).resolves.toBe('raw')
		})

		it('readWebStream returns a response body stream without buffering through read()', async () => {
			await adapter.upload(
				'pub',
				'listings/1/test.jpg',
				Readable.from(Buffer.from('public')),
				{ mimeType: 'image/jpeg' }
			)

			const response = new Response(
				await adapter.readWebStream('pub', 'listings/1/test.jpg')
			)

			expect(await response.text()).toBe('public')
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
		it('removes the entry so subsequent read throws', async () => {
			await adapter.upload(
				'pub',
				'listings/1/delete-me.png',
				Readable.from(Buffer.from('data')),
				{
					mimeType: 'image/png',
				}
			)
			await adapter.delete('pub', 'listings/1/delete-me.png')
			await expect(
				adapter.read('pub', 'listings/1/delete-me.png')
			).rejects.toThrow()
		})

		it('does not throw when the entry does not exist', async () => {
			await expect(
				adapter.delete('pub', 'listings/1/nonexistent.png')
			).resolves.not.toThrow()
		})
	})

	describe('isolation between dir prefixes', () => {
		it('stores raw and pub entries independently', async () => {
			const rawBuf = Buffer.from('raw-data')
			const pubBuf = Buffer.from('pub-data')
			await adapter.upload('raw', 'listings/1/same.jpg', Readable.from(rawBuf), {
				mimeType: 'image/jpeg',
			})
			await adapter.upload('pub', 'listings/1/same.jpg', Readable.from(pubBuf), {
				mimeType: 'image/jpeg',
			})
			expect(await adapter.read('raw', 'listings/1/same.jpg')).toEqual(rawBuf)
			expect(await adapter.read('pub', 'listings/1/same.jpg')).toEqual(pubBuf)
		})
	})
})

describe(TigrisStorageAdapter, () => {
	const defaultMediaOrigin = 'https://test-bucket.fly.storage.tigris.dev'
	const adapter = new TigrisStorageAdapter({
		bucketName: 'test-bucket',
		accessKeyId: 'fake',
		secretAccessKey: 'fake',
		endpointUrl: 'https://fly.storage.tigris.dev',
		mediaOrigin: defaultMediaOrigin,
	})

	describe('publicUrl', () => {
		it('returns mediaOrigin/pub/ URL for a pub/ path', () => {
			expect(adapter.publicUrl('listings/1/uuid.jpg')).toBe(
				'https://test-bucket.fly.storage.tigris.dev/pub/listings/1/uuid.jpg'
			)
		})

		it('returns a custom mediaOrigin/pub/ URL when configured', () => {
			const withMedia = new TigrisStorageAdapter({
				bucketName: 'test-bucket',
				accessKeyId: 'fake',
				secretAccessKey: 'fake',
				endpointUrl: 'https://fly.storage.tigris.dev',
				mediaOrigin: 'https://media.example.com',
			})
			expect(withMedia.publicUrl('listings/1/uuid.jpg')).toBe(
				'https://media.example.com/pub/listings/1/uuid.jpg'
			)
		})

		it('normalizes a trailing slash on mediaOrigin', () => {
			const withMedia = new TigrisStorageAdapter({
				bucketName: 'test-bucket',
				accessKeyId: 'fake',
				secretAccessKey: 'fake',
				endpointUrl: 'https://fly.storage.tigris.dev',
				mediaOrigin: 'https://media.example.com/',
			})
			expect(withMedia.publicUrl('x.jpg')).toBe(
				'https://media.example.com/pub/x.jpg'
			)
		})

		it('percent-encodes each path segment', () => {
			expect(adapter.publicUrl('listing_photos/a b.jpg')).toBe(
				'https://test-bucket.fly.storage.tigris.dev/pub/listing_photos/a%20b.jpg'
			)
		})

		it('throws when mediaOrigin is not a valid URL', () => {
			expect(() =>
				new TigrisStorageAdapter({
					bucketName: 'test-bucket',
					accessKeyId: 'fake',
					secretAccessKey: 'fake',
					endpointUrl: 'https://fly.storage.tigris.dev',
					mediaOrigin: 'not-a-url',
				}).publicUrl('x.jpg')
			).toThrow()
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
				mediaOrigin: defaultMediaOrigin,
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
