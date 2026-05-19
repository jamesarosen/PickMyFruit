import { readFile as nodeReadFile } from 'node:fs/promises'
import { createPublicKey, verify, type KeyObject } from 'node:crypto'

/**
 * Default location of the Ed25519 public key Fly mounts into every Machine.
 * Used to verify the `Fly-Src-Signature` header.
 *
 * @see https://community.fly.io/t/fly-src-authenticating-http-requests-between-fly-apps/20566
 */
export const DEFAULT_FLY_SRC_KEY_PATH = '/.fly/fly-src.pub'

/** Default replay window. Fly's example uses 10s; 30s gives more clock-skew tolerance without inviting replays. */
export const DEFAULT_FLY_SRC_MAX_AGE_MS = 30_000

/** Parsed shape of the `Fly-Src` header. */
export interface FlySrc {
	instance: string
	app: string
	org: string
	/** Unix timestamp in seconds, as emitted by Fly's edge. */
	ts: number
}

/**
 * Parses the semicolon-delimited `Fly-Src` header.
 * Example: `instance=abc;app=myapp;org=myorg;ts=1700000000`.
 *
 * Returns null when the header is missing required keys or `ts` is not a number.
 */
export function parseFlySrc(value: string | null | undefined): FlySrc | null {
	if (!value) return null
	const fields: Record<string, string> = {}
	for (const pair of value.split(';')) {
		const eq = pair.indexOf('=')
		if (eq <= 0) continue
		fields[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
	}
	const { instance, app, org, ts } = fields
	if (!instance || !app || !org || !ts) return null
	const tsNum = Number(ts)
	if (!Number.isFinite(tsNum)) return null
	return { instance, app, org, ts: tsNum }
}

/**
 * SPKI DER prefix for an Ed25519 public key (RFC 8410). Prepended to the raw
 * 32-byte key so `crypto.createPublicKey` can ingest it.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/** Builds a Node KeyObject from the 32-byte raw Ed25519 key Fly writes to disk. */
export function flyPublicKeyFromRawHex(hex: string): KeyObject {
	const raw = Buffer.from(hex.trim(), 'hex')
	if (raw.length !== 32)
		throw new Error(
			`Fly-Src public key must be 32 bytes (got ${raw.length}); is /.fly/fly-src.pub hex-encoded?`
		)
	const spki = Buffer.concat([ED25519_SPKI_PREFIX, raw])
	return createPublicKey({ key: spki, format: 'der', type: 'spki' })
}

/** Verifies a base64 Ed25519 signature over the canonical `Fly-Src` header bytes. */
export function verifyFlySrcSignature(
	src: string,
	signatureBase64: string,
	publicKey: KeyObject
): boolean {
	let signature: Buffer
	try {
		signature = Buffer.from(signatureBase64, 'base64')
	} catch {
		return false
	}
	// Ed25519 signatures are always 64 bytes.
	if (signature.length !== 64) return false
	try {
		return verify(null, Buffer.from(src, 'utf8'), publicKey, signature)
	} catch {
		return false
	}
}

export interface IsFlyInternalRequestDeps {
	/** Reads the public key file. Injectable for tests / virtual FS. */
	readFile?: (path: string) => Promise<Buffer>
	/** Wall clock for ts freshness. */
	now?: () => number
	/** Path to the Fly-Src public key. */
	keyPath?: string
	/** Expected `app` value. Fly sets `FLY_APP_NAME` on every Machine. */
	appName: string | null | undefined
	/** Max age of the `ts` field, in milliseconds. */
	maxAgeMs?: number
}

export interface FlyHeaders {
	'fly-src': string | null
	'fly-src-signature': string | null
}

/**
 * Returns true only when the request carries a valid, fresh, app-matching
 * `Fly-Src` proving it came from another Machine in the same Fly org through
 * Fly's private 6PN edge. Designed to be safe-by-default: returns false on any
 * missing input, unreadable key file (local dev), bad signature, mismatched
 * destination app, or expired timestamp.
 *
 * @see https://community.fly.io/t/detect-public-vs-private-connection/20971
 * @see https://community.fly.io/t/fly-src-authenticating-http-requests-between-fly-apps/20566
 */
export async function isFlyInternalRequest(
	headers: FlyHeaders,
	deps: IsFlyInternalRequestDeps
): Promise<boolean> {
	const src = headers['fly-src']
	const sig = headers['fly-src-signature']
	if (!src || !sig) return false
	if (!deps.appName) return false

	const parsed = parseFlySrc(src)
	if (!parsed) return false
	if (parsed.app !== deps.appName) return false

	const now = (deps.now ?? Date.now)()
	const maxAgeMs = deps.maxAgeMs ?? DEFAULT_FLY_SRC_MAX_AGE_MS
	const ageMs = now - parsed.ts * 1_000
	// Reject stale timestamps. A small future-skew (negative age) is fine — clocks drift.
	if (ageMs > maxAgeMs) return false

	const keyPath = deps.keyPath ?? DEFAULT_FLY_SRC_KEY_PATH
	const readFile = deps.readFile ?? nodeReadFile
	let keyBytes: Buffer
	try {
		keyBytes = await readFile(keyPath)
	} catch {
		// ENOENT in local dev, or any other read failure: treat as "no internal traffic possible".
		return false
	}

	let publicKey: KeyObject
	try {
		publicKey = flyPublicKeyFromRawHex(keyBytes.toString('utf8'))
	} catch {
		return false
	}

	return verifyFlySrcSignature(src, sig, publicKey)
}
