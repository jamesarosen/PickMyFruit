import { randomBytes } from 'node:crypto'

/**
 * Minimal UUIDv7 generator — 48 bits of unix millisecond time + 74 bits of
 * randomness + version/variant nibbles. Lexicographically sortable, which is
 * useful for `ORDER BY id` on workflow rows.
 *
 * @see https://datatracker.ietf.org/doc/rfc9562/
 */
export function uuidv7(now: number = Date.now()): string {
	const ts = BigInt(now)
	const tsHi = Number((ts >> 16n) & 0xffffffffn)
	const tsLo = Number(ts & 0xffffn)

	const rand = randomBytes(10)
	rand[0] = (rand[0] & 0x0f) | 0x70 // version 7
	rand[2] = (rand[2] & 0x3f) | 0x80 // RFC 4122 variant

	const hex = (n: number, width: number) => n.toString(16).padStart(width, '0')
	const b = (offset: number, length: number) => {
		let out = ''
		for (let i = 0; i < length; i++) {
			out += hex(rand[offset + i], 2)
		}
		return out
	}

	return [hex(tsHi, 8), hex(tsLo, 4), b(0, 2), b(2, 2), b(4, 6)].join('-')
}
