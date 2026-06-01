import { defineWorkflow } from '@pickmyfruit/kokoto/runtime.server'
import { createInquiryTx } from '@/data/queries.server'
import { sendInquiryEmail } from '@/lib/email-templates.server'

/**
 * Input for {@link submitInquiryWorkflow}. The handler that starts the workflow
 * is responsible for resolving identities, listing details, and the request
 * base URL — by the time we get here every pre-check has passed.
 *
 * Inputs are serialized to `_dc_workflow.input` so this shape must be
 * JSON-friendly (no `Date`, no `undefined`).
 */
export interface SubmitInquiryInput {
	listingId: number
	gleanerId: string
	note: string | null
	baseUrl: string
	gleaner: { name: string; email: string }
	owner: { name: string; email: string }
	listing: {
		id: number
		type: string
		notes: string | null
		quantity: string | null
	}
}

/** Result returned by {@link submitInquiryWorkflow.result()} on success. */
export interface SubmitInquiryOutput {
	inquiryId: number
}

/**
 * Durable workflow for `POST /submitInquiry`. Two steps:
 *
 *   1. `sendOwnerEmail` — Resend send carrying a stable `Idempotency-Key`
 *      derived from the workflow id, so a crash that occurs after Resend
 *      accepts the request but before the `_dc_step` row commits does not
 *      deliver a second email on replay.
 *   2. `createInquiry` — insert the row with `email_sent_at = ctx.now()`.
 *      `ctx.now()` is the workflow's `started_at` and is stable across
 *      replays.
 *
 * The workflow itself is enqueued with `idempotencyKey =
 * inquiry:<listingId>:<gleanerId>:<utcDay>` so a second submit within the
 * same UTC day reuses the in-flight workflow id rather than starting a new
 * one (cheaper than re-running pre-checks, and protects against
 * double-clicks racing past `hasRecentInquiry`).
 */
export const submitInquiryWorkflow = defineWorkflow(
	'submitInquiry',
	async (ctx, input: SubmitInquiryInput): Promise<SubmitInquiryOutput> => {
		await ctx.step('sendOwnerEmail', async () => {
			await sendInquiryEmail(
				{
					baseUrl: input.baseUrl,
					gleaner: input.gleaner,
					gleanerNote: input.note,
					listing: input.listing,
					owner: input.owner,
				},
				{ idempotencyKey: ctx.stepKey('sendOwnerEmail') }
			)
			return null
		})

		// txStep: the INSERT into `inquiries` and the `_dc_step` row commit in
		// one libSQL transaction. If the process dies between the user write
		// and the step-log write, both roll back and the next attempt re-runs
		// cleanly. No idempotency key needed for this step because it owns
		// the only write.
		const inquiry = await ctx.txStep('createInquiry', async (tx) => {
			const row = await createInquiryTx(tx, {
				listingId: input.listingId,
				gleanerId: input.gleanerId,
				note: input.note,
				emailSentAt: new Date(ctx.now()),
			})
			return { inquiryId: row.id }
		})

		return inquiry
	},
	{ queue: 'email' }
)

/** Build the per-day idempotency key used to enqueue the workflow. */
export function inquiryWorkflowIdempotencyKey(
	listingId: number,
	gleanerId: string,
	now: Date = new Date()
): string {
	const day = now.toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
	return `inquiry:${listingId}:${gleanerId}:${day}`
}
