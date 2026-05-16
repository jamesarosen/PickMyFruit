import { z } from 'zod'

/**
 * The opaque cursor exchanged with the resend-sync worker. Today it's a
 * base64url-encoded JSON tuple of `(updated_at, id)`. The worker never opens
 * the payload — only this module does — so the encoding can change without
 * coordinating with the worker.
 */
export const decodedCursorSchema = z.object({
	updatedAt: z.number().int().nonnegative(),
	userId: z.string(),
})

export type DecodedCursor = z.infer<typeof decodedCursorSchema>

/** Cursor that selects "from the beginning of the user table". */
export const ORIGIN_CURSOR: DecodedCursor = { updatedAt: 0, userId: '' }

function base64urlEncode(input: string): string {
	return Buffer.from(input, 'utf8')
		.toString('base64')
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '')
}

function base64urlDecode(input: string): string {
	const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4))
	const normalized = input.replaceAll('-', '+').replaceAll('_', '/') + pad
	return Buffer.from(normalized, 'base64').toString('utf8')
}

/** Encodes a decoded cursor as an opaque, URL-safe string. */
export function encodeCursor(cursor: DecodedCursor): string {
	return base64urlEncode(JSON.stringify(cursor))
}

/**
 * Decodes a cursor produced by `encodeCursor`. Empty or unparseable input
 * resolves to `ORIGIN_CURSOR` so the API treats both "no cursor" and "garbage
 * cursor" as "start over" — the worker is idempotent so a rewind is safe.
 */
export function decodeCursor(raw: string | null | undefined): DecodedCursor {
	if (!raw) return ORIGIN_CURSOR
	try {
		const json = base64urlDecode(raw)
		const parsed = decodedCursorSchema.safeParse(JSON.parse(json))
		return parsed.success ? parsed.data : ORIGIN_CURSOR
	} catch {
		return ORIGIN_CURSOR
	}
}
