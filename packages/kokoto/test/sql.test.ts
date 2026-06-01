import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client/node'
import { KOKOTO_DDL } from '../src/schema.server.ts'
import {
	claimPending,
	decodePayload,
	encodePayload,
	finalizeWorkflow,
	reclaimExpired,
	requestCancel,
	selectWorkflowById,
} from '../src/sql.server.ts'
import { PayloadTooLargeError } from '../src/errors.ts'
import { newClient } from './helpers.ts'

async function insertWorkflow(
	client: Client,
	id: string,
	overrides: Partial<{
		queue: string | null
		executor: string | null
		status: string
		scheduledFor: number
		claimExpiresAt: number | null
	}> = {}
): Promise<void> {
	await client.execute({
		sql: `INSERT INTO _dc_workflow
				(id, name, status, queue, input, attempts, max_attempts,
				 scheduled_for, created_at, executor_id, claim_expires_at,
				 protocol_version)
			VALUES (?, 'w', ?, ?, '{}', 0, 3, ?, ?, ?, ?, 1)`,
		args: [
			id,
			overrides.status ?? 'pending',
			overrides.queue ?? null,
			overrides.scheduledFor ?? 0,
			Date.now(),
			overrides.executor ?? null,
			overrides.claimExpiresAt ?? null,
		],
	})
}

const TEST_LEASE_MS = 5_000

describe('encode/decode payload', () => {
	it('round-trips primitives and objects', () => {
		expect(decodePayload(encodePayload(null))).toBeNull()
		expect(decodePayload(encodePayload(42))).toBe(42)
		expect(decodePayload(encodePayload({ a: [1, 2] }))).toEqual({ a: [1, 2] })
	})

	it('throws for payloads over 1MB', () => {
		const huge = 'x'.repeat(1_000_001)
		expect(() => encodePayload(huge)).toThrow(PayloadTooLargeError)
	})

	it('treats undefined as null', () => {
		expect(decodePayload(encodePayload(undefined))).toBeNull()
	})
})

describe('claimPending', () => {
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

	it('claims only rows where scheduled_for has passed', async () => {
		await insertWorkflow(client, 'ready', { scheduledFor: 0 })
		await insertWorkflow(client, 'future', {
			scheduledFor: Date.now() + 60_000,
		})
		const claimed = await claimPending(
			client,
			'exec-a',
			Date.now(),
			TEST_LEASE_MS,
			10
		)
		expect(claimed.map((r) => r.id)).toEqual(['ready'])
	})

	it('marks claimed rows running and stamps claim_expires_at', async () => {
		await insertWorkflow(client, 'w', { scheduledFor: 0 })
		const now = Date.now()
		const claimed = await claimPending(client, 'exec-a', now, TEST_LEASE_MS, 10)
		expect(claimed[0].status).toBe('running')
		expect(claimed[0].attempts).toBe(1)
		expect(claimed[0].executor_id).toBe('exec-a')
		expect(claimed[0].claim_expires_at).toBe(now + TEST_LEASE_MS)
	})

	it('filters by queue name when provided', async () => {
		await insertWorkflow(client, 'general', { queue: null })
		await insertWorkflow(client, 'email', { queue: 'email' })
		const onlyEmail = await claimPending(
			client,
			'x',
			Date.now(),
			TEST_LEASE_MS,
			10,
			'email'
		)
		expect(onlyEmail.map((r) => r.id)).toEqual(['email'])
	})

	it('filters to NULL queue rows when queueFilter is null', async () => {
		await insertWorkflow(client, 'general', { queue: null })
		await insertWorkflow(client, 'email', { queue: 'email' })
		const onlyGeneral = await claimPending(
			client,
			'x',
			Date.now(),
			TEST_LEASE_MS,
			10,
			null
		)
		expect(onlyGeneral.map((r) => r.id)).toEqual(['general'])
	})

	it('respects the limit argument', async () => {
		for (let i = 0; i < 5; i++) {
			await insertWorkflow(client, `w${i}`, { scheduledFor: 0 })
		}
		const claimed = await claimPending(client, 'x', Date.now(), TEST_LEASE_MS, 2)
		expect(claimed).toHaveLength(2)
	})
})

describe('reclaimExpired', () => {
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

	it('resets running rows whose lease has expired', async () => {
		const now = Date.now()
		await insertWorkflow(client, 'orphan', {
			status: 'running',
			executor: 'dead-exec',
			claimExpiresAt: now - 1, // already past
		})
		const count = await reclaimExpired(client, now)
		expect(count).toBe(1)
		const row = await selectWorkflowById(client, 'orphan')
		expect(row?.status).toBe('pending')
		expect(row?.executor_id).toBeNull()
		expect(row?.claim_expires_at).toBeNull()
	})

	it('leaves running rows whose lease is still alive', async () => {
		const now = Date.now()
		await insertWorkflow(client, 'mine', {
			status: 'running',
			executor: 'live-exec',
			claimExpiresAt: now + 60_000, // future
		})
		const count = await reclaimExpired(client, now)
		expect(count).toBe(0)
		const row = await selectWorkflowById(client, 'mine')
		expect(row?.status).toBe('running')
		expect(row?.executor_id).toBe('live-exec')
	})

	it('reclaims rows whose lease is NULL (legacy / never-leased)', async () => {
		await insertWorkflow(client, 'legacy', {
			status: 'running',
			executor: 'dead-exec',
			claimExpiresAt: null,
		})
		const count = await reclaimExpired(client, Date.now())
		expect(count).toBe(1)
		const row = await selectWorkflowById(client, 'legacy')
		expect(row?.status).toBe('pending')
	})
})

describe('requestCancel', () => {
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

	it('transitions pending rows straight to cancelled', async () => {
		await insertWorkflow(client, 'p')
		const status = await requestCancel(client, 'p', Date.now())
		expect(status).toBe('cancelled')
		const row = await selectWorkflowById(client, 'p')
		expect(row?.status).toBe('cancelled')
		expect(row?.ended_at).not.toBeNull()
	})

	it('sets cancel_requested_at on running rows', async () => {
		await insertWorkflow(client, 'r', { status: 'running' })
		const status = await requestCancel(client, 'r', 12345)
		expect(status).toBe('requested')
		const row = await selectWorkflowById(client, 'r')
		expect(row?.status).toBe('running')
		expect(row?.cancel_requested_at).toBe(12345)
	})

	it('no-ops on terminal rows', async () => {
		await insertWorkflow(client, 's', { status: 'pending' })
		await finalizeWorkflow(client, 's', 'success', Date.now(), '{}')
		const status = await requestCancel(client, 's', Date.now())
		expect(status).toBe('noop')
	})
})
