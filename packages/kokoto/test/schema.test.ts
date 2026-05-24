import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client/node'
import {
	KOKOTO_DDL,
	KOKOTO_TABLES,
	PAYLOAD_BYTE_CAP,
} from '../src/schema.server.ts'
import { newClient } from './helpers.ts'

describe('schema.server', () => {
	let client: Client

	beforeEach(async () => {
		client = await newClient()
		for (const stmt of KOKOTO_DDL) {
			await client.execute(stmt)
		}
	})

	afterEach(() => {
		client.close()
	})

	it('creates every kokoto table', async () => {
		const result = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_dc_%' ORDER BY name"
		)
		const names = result.rows.map((r) => String(r.name))
		expect(names).toEqual([...KOKOTO_TABLES].sort())
	})

	it('rejects oversized JSON payloads via CHECK constraint', async () => {
		const huge = JSON.stringify({ blob: 'x'.repeat(PAYLOAD_BYTE_CAP + 100) })
		await expect(
			client.execute({
				sql: `INSERT INTO _dc_workflow
						(id, name, status, input, attempts, max_attempts,
						 scheduled_for, created_at, protocol_version)
					VALUES (?, ?, 'pending', ?, 0, 3, 0, ?, 1)`,
				args: ['too-big', 'oversize', huge, Date.now()],
			})
		).rejects.toThrow()
	})

	it('rejects invalid JSON in input column', async () => {
		await expect(
			client.execute({
				sql: `INSERT INTO _dc_workflow
						(id, name, status, input, attempts, max_attempts,
						 scheduled_for, created_at, protocol_version)
					VALUES (?, ?, 'pending', ?, 0, 3, 0, ?, 1)`,
				args: ['bad-json', 'oversize', 'not-json', Date.now()],
			})
		).rejects.toThrow()
	})

	it('enforces unique idempotency_key', async () => {
		const args = (id: string) => ({
			sql: `INSERT INTO _dc_workflow
					(id, name, status, input, attempts, max_attempts,
					 scheduled_for, created_at, idempotency_key, protocol_version)
				VALUES (?, 'test', 'pending', '{}', 0, 3, 0, ?, 'dup', 1)`,
			args: [id, Date.now()],
		})
		await client.execute(args('w1'))
		await expect(client.execute(args('w2'))).rejects.toThrow()
	})

	it('seeds protocol_version into _dc_meta', async () => {
		const result = await client.execute(
			"SELECT value FROM _dc_meta WHERE key = 'protocol_version'"
		)
		expect(result.rows[0]?.value).toBe('1')
	})

	it('is idempotent (re-running DDL is a no-op)', async () => {
		for (const stmt of KOKOTO_DDL) {
			await client.execute(stmt)
		}
		const result = await client.execute(
			"SELECT count(*) AS c FROM _dc_meta WHERE key = 'protocol_version'"
		)
		expect(Number(result.rows[0]?.c)).toBe(1)
	})
})
