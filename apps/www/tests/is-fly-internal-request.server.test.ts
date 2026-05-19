import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import {
	isFlyInternalRequest,
	parseFlySrc,
	verifyFlySrcSignature,
	flyPublicKeyFromRawHex,
} from '@/lib/is-fly-internal-request.server'

const APP_NAME = 'pickmyfruit'
const KEY_PATH = '/.fly/fly-src.pub'

interface Fixture {
	publicKeyHex: string
	privateKey: KeyObject
	readFile: (path: string) => Promise<Buffer>
}

/** Generates an Ed25519 keypair and a virtual FS that serves the public half at KEY_PATH. */
function makeFixture(): Fixture {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519')
	const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
	const publicKeyHex = raw.toString('hex')
	const readFile = async (path: string) => {
		if (path === KEY_PATH) return Buffer.from(publicKeyHex, 'utf8')
		const err = new Error('ENOENT') as NodeJS.ErrnoException
		err.code = 'ENOENT'
		throw err
	}
	return { publicKeyHex, privateKey, readFile }
}

function signSrc(src: string, privateKey: KeyObject): string {
	return sign(null, Buffer.from(src, 'utf8'), privateKey).toString('base64')
}

function makeSrc(
	overrides: Partial<{
		instance: string
		app: string
		org: string
		ts: number
	}> = {}
): string {
	const fields = {
		instance: 'machine-abc',
		app: APP_NAME,
		org: 'org-1',
		ts: Math.floor(Date.now() / 1_000),
		...overrides,
	}
	return `instance=${fields.instance};app=${fields.app};org=${fields.org};ts=${fields.ts}`
}

describe(parseFlySrc, () => {
	it('parses the documented semicolon-delimited format', () => {
		expect(parseFlySrc('instance=m1;app=a;org=o;ts=1700000000')).toStrictEqual({
			instance: 'm1',
			app: 'a',
			org: 'o',
			ts: 1_700_000_000,
		})
	})

	it.each([
		null,
		undefined,
		'',
		'app=a;ts=1',
		'instance=m;app=a;org=o',
		'instance=m;app=a;org=o;ts=notanumber',
	])('returns null for invalid input %j', (input) => {
		expect(parseFlySrc(input)).toBeNull()
	})
})

describe(verifyFlySrcSignature, () => {
	it('accepts a valid signature and rejects tampered bytes', () => {
		const { publicKeyHex, privateKey } = makeFixture()
		const publicKey = flyPublicKeyFromRawHex(publicKeyHex)
		const src = makeSrc()
		const sig = signSrc(src, privateKey)
		expect(verifyFlySrcSignature(src, sig, publicKey)).toBe(true)
		expect(verifyFlySrcSignature(src + 'x', sig, publicKey)).toBe(false)
	})

	it.each(['', 'not-base64-!!!', Buffer.alloc(63).toString('base64')])(
		'rejects malformed signature %j',
		(badSig) => {
			const { publicKeyHex } = makeFixture()
			const publicKey = flyPublicKeyFromRawHex(publicKeyHex)
			expect(verifyFlySrcSignature(makeSrc(), badSig, publicKey)).toBe(false)
		}
	)
})

describe(isFlyInternalRequest, () => {
	it('returns true for a valid, fresh, app-matching, signed request', async () => {
		const { privateKey, readFile } = makeFixture()
		const src = makeSrc()
		const sig = signSrc(src, privateKey)

		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{ readFile, keyPath: KEY_PATH, appName: APP_NAME }
		)
		expect(ok).toBe(true)
	})

	it('returns false when either header is missing', async () => {
		const { readFile } = makeFixture()
		const deps = { readFile, keyPath: KEY_PATH, appName: APP_NAME }
		expect(
			await isFlyInternalRequest(
				{ 'fly-src': null, 'fly-src-signature': 'sig' },
				deps
			)
		).toBe(false)
		expect(
			await isFlyInternalRequest(
				{ 'fly-src': makeSrc(), 'fly-src-signature': null },
				deps
			)
		).toBe(false)
	})

	it('returns false when the public key file is missing (local dev)', async () => {
		const { privateKey } = makeFixture()
		const src = makeSrc()
		const sig = signSrc(src, privateKey)
		const readFile = async () => {
			const err = new Error('ENOENT') as NodeJS.ErrnoException
			err.code = 'ENOENT'
			throw err
		}
		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{ readFile, keyPath: KEY_PATH, appName: APP_NAME }
		)
		expect(ok).toBe(false)
	})

	it('returns false when the app field does not match FLY_APP_NAME', async () => {
		const { privateKey, readFile } = makeFixture()
		const src = makeSrc({ app: 'some-other-app' })
		const sig = signSrc(src, privateKey)
		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{ readFile, keyPath: KEY_PATH, appName: APP_NAME }
		)
		expect(ok).toBe(false)
	})

	it('returns false when ts is older than the replay window', async () => {
		const { privateKey, readFile } = makeFixture()
		const now = 1_700_000_000_000
		const src = makeSrc({ ts: Math.floor(now / 1_000) - 60 * 60 })
		const sig = signSrc(src, privateKey)
		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{
				readFile,
				keyPath: KEY_PATH,
				appName: APP_NAME,
				now: () => now,
				maxAgeMs: 30_000,
			}
		)
		expect(ok).toBe(false)
	})

	it('returns false when the signature was made with a different key', async () => {
		const honest = makeFixture()
		const attacker = makeFixture()
		const src = makeSrc()
		const sig = signSrc(src, attacker.privateKey)
		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{ readFile: honest.readFile, keyPath: KEY_PATH, appName: APP_NAME }
		)
		expect(ok).toBe(false)
	})

	it('returns false when appName is unset', async () => {
		const { privateKey, readFile } = makeFixture()
		const src = makeSrc()
		const sig = signSrc(src, privateKey)
		const ok = await isFlyInternalRequest(
			{ 'fly-src': src, 'fly-src-signature': sig },
			{ readFile, keyPath: KEY_PATH, appName: undefined }
		)
		expect(ok).toBe(false)
	})
})
