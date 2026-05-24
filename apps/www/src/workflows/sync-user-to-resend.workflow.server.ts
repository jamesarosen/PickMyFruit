import { defineWorkflow } from '@pickmyfruit/kokoto'
import { serverEnv } from '@/lib/env.server'
import { logger } from '@/lib/logger.server'
import {
	createResendContactUpsert,
	type ResendUpsertResult,
} from '@/lib/resend-contacts.server'

/**
 * Input for {@link syncUserToResendWorkflow}. Carries only the fields the
 * Resend Contacts API consumes plus the user id (used for log correlation
 * and the workflow's idempotency key).
 *
 * `updatedAtMs` is the persisted `user.updated_at` so each profile edit
 * produces its own workflow id; a duplicate enqueue for the same edit
 * collapses on the idempotency key.
 */
export interface SyncUserInput {
	userId: string
	email: string
	name: string
	updatedAtMs: number
}

/**
 * Steps committed to `_dc_step` are exactly-once at the log boundary. Resend
 * itself, however, is at-least-once: a crash after Resend accepts our PATCH
 * but before we commit the step row will run the step again on the next
 * dispatch. The contact upsert is naturally idempotent (same email →
 * same remote state) so that's fine.
 */

/** Maximum number of in-step retries before the step gives up. */
const MAX_STEP_ATTEMPTS = 5
/** Base delay for exponential backoff inside the step (ms). */
const BASE_BACKOFF_MS = 500
/** Hard cap on backoff between attempts. */
const MAX_BACKOFF_MS = 15_000

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return
	await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
	if (retryAfterMs != null) return Math.min(retryAfterMs, MAX_BACKOFF_MS)
	const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1)
	return Math.min(exp, MAX_BACKOFF_MS)
}

/**
 * Run the upsert, retrying server/network errors with exponential backoff.
 * Client errors (4xx that aren't 429) throw immediately — they indicate a
 * malformed request that will not succeed on retry (poison pill).
 */
async function upsertWithRetry(
	upsert: (input: {
		email: string
		name: string
	}) => Promise<ResendUpsertResult>,
	input: { userId: string; email: string; name: string }
): Promise<void> {
	// Sequential retry — Promise.all() would defeat the point of backoff.
	/* eslint-disable no-await-in-loop */
	for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
		const result = await upsert({ email: input.email, name: input.name })
		if (result.kind === 'ok') return

		if (result.kind === 'client-error') {
			throw new Error(
				`Resend contact upsert refused (${result.status}): ${result.message}`
			)
		}

		const transient =
			result.kind === 'server-error'
				? `${result.status} ${result.message}`
				: `network: ${result.error.message}`
		const retryAfterMs =
			result.kind === 'server-error' ? result.retryAfterMs : null

		if (attempt === MAX_STEP_ATTEMPTS) {
			throw new Error(
				`Resend contact upsert failed after ${MAX_STEP_ATTEMPTS} attempts: ${transient}`
			)
		}

		const wait = backoffMs(attempt, retryAfterMs)
		logger.warn(
			{ userId: input.userId, attempt, wait, reason: transient },
			'syncUserToResend: transient error, retrying'
		)
		await sleep(wait)
	}
	/* eslint-enable no-await-in-loop */
}

/**
 * Durable workflow that syncs a user's profile (name + email) to their
 * Resend contact entry. Runs on the `resend` queue (low concurrency,
 * so we never blow the Resend rate limit).
 *
 * Triggered from Better Auth's user `create.after` and `update.after`
 * database hooks. The workflow's idempotency key is
 * `sync-user:<userId>:<updatedAtMs>` so duplicate hook invocations for the
 * same revision collapse, and out-of-order delivery for distinct revisions
 * gets distinct workflows.
 */
export const syncUserToResendWorkflow = defineWorkflow(
	'syncUserToResend',
	async (ctx, input: SyncUserInput): Promise<null> => {
		await ctx.step('upsertContact', async () => {
			// `silent` and `console` providers have no Resend account configured —
			// no-op so dev and test runs of this workflow don't blow up.
			if (serverEnv.email.PROVIDER !== 'resend') {
				logger.debug(
					{ userId: input.userId, provider: serverEnv.email.PROVIDER },
					'syncUserToResend: skipping upsert (EMAIL_PROVIDER != resend)'
				)
				return null
			}
			const upsert = createResendContactUpsert({
				apiKey: serverEnv.email.RESEND_API_KEY,
			})
			await upsertWithRetry(upsert, {
				userId: input.userId,
				email: input.email,
				name: input.name,
			})
			return null
		})
		return null
	},
	{ queue: 'resend' }
)

/** Build the per-revision idempotency key used to enqueue the workflow. */
export function syncUserIdempotencyKey(
	userId: string,
	updatedAtMs: number
): string {
	return `sync-user:${userId}:${updatedAtMs}`
}
