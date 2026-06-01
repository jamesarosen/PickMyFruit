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

	// Drift guard: the host app's migration journal must produce the same
	// table + column shape as KOKOTO_DDL. The two paths differ in style
	// (Drizzle generates backtick-quoted DDL with separate `CREATE UNIQUE
	// INDEX` for inline `UNIQUE`; the constant is hand-written ANSI SQL with
	// `IF NOT EXISTS`), so we compare *structure* — table names, column
	// names, column types — not raw SQL text. A new column on one side that
	// isn't mirrored on the other will fail this test.
	it('matches the host app migration in table + column shape', async () => {
		const ddlShape = await readSchemaShape(client)

		const { newClient: fresh } = await import('./helpers.ts')
		const migrationClient = await fresh()
		try {
			const { readFileSync, existsSync } = await import('node:fs')
			const url = new URL(
				'../../../apps/www/drizzle/0008_add_kokoto.sql',
				import.meta.url
			)
			if (!existsSync(url)) {
				// Library checked out without the host app — skip silently.
				return
			}
			const sql = readFileSync(url, 'utf8')
			for (const stmt of sql.split('--> statement-breakpoint')) {
				const trimmed = stmt.trim()
				if (trimmed) await migrationClient.execute(trimmed)
			}
			const migrationShape = await readSchemaShape(migrationClient)
			expect(migrationShape).toEqual(ddlShape)
		} finally {
			migrationClient.close()
		}
	})
})

/**
 * Returns `{ tableName: { columnName: columnType } }` for every `_dc_*`
 * table on the connection. Uses `PRAGMA table_info` so it compares the
 * post-parse SQLite shape, not the raw DDL text.
 */
async function readSchemaShape(
	client: import('@libsql/client/node').Client
): Promise<Record<string, Record<string, string>>> {
	const tables = await client.execute(
		`SELECT name FROM sqlite_master
		 WHERE type = 'table' AND name LIKE '_dc_%'
		 ORDER BY name`
	)
	const shape: Record<string, Record<string, string>> = {}
	for (const row of tables.rows) {
		const name = row.name as string
		const cols = await client.execute(`PRAGMA table_info(${name})`)
		const colMap: Record<string, string> = {}
		for (const col of cols.rows) {
			colMap[col.name as string] = (col.type as string).toLowerCase()
		}
		shape[name] = colMap
	}
	return shape
}
