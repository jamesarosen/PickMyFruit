import { Resend } from 'resend'
import type {
	ResendClient,
	ResendContact,
	ResendResult,
} from '@/lib/resend-sync-process-row.server'

/** Splits a full name into first/last for Resend's contact fields. */
function splitName(fullName: string): { firstName: string; lastName?: string } {
	const parts = fullName.trim().split(/\s+/)
	return {
		firstName: parts[0] ?? '',
		lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
	}
}

type ResendError = {
	statusCode: number | null
	message: string
	name?: string
}

function mapError(error: ResendError): ResendResult {
	const status = error.statusCode
	if (status === null) {
		return { kind: 'network-error', error: new Error(error.message) }
	}
	if (status >= 400 && status < 500) {
		return { kind: 'client-error', status, message: error.message }
	}
	return { kind: 'server-error', status, message: error.message }
}

/**
 * Creates a ResendClient that upserts a user contact into the given audience.
 *
 * Resend has no native upsert. We use its documented existence check
 * (GET /audiences/{id}/contacts/{email}) to decide between create (POST) and
 * update (PATCH):
 *
 * - 404 from GET → POST a new contact with `unsubscribed: false` (matches
 *   Resend's default for fresh contacts).
 * - 200 from GET → PATCH with the new field values. The PATCH body
 *   intentionally omits `unsubscribed` so the user's current Resend opt-in
 *   state is preserved across syncs. Never blindly re-subscribe a user who
 *   opted out (CAN-SPAM / GDPR).
 *
 * When the `user` schema gains a subscription field, include it on both the
 * POST and the PATCH as `unsubscribed: !user.subscribed` so opt-outs made
 * in-app propagate to Resend.
 *
 * @see https://resend.com/docs/dashboard/audiences/contacts#view-contacts
 * @see https://resend.com/docs/dashboard/audiences/contacts#edit-contacts
 */
export function createResendSyncClient(
	apiKey: string,
	audienceId: string
): ResendClient {
	const resend = new Resend(apiKey)

	return async (contact: ResendContact) => {
		const { firstName, lastName } = splitName(contact.name)

		const existing = await resend.contacts.get({
			audienceId,
			email: contact.email,
		})

		if (existing.error) {
			if (existing.error.statusCode !== 404) {
				return mapError(existing.error)
			}

			const create = await resend.contacts.create({
				audienceId,
				email: contact.email,
				firstName,
				lastName,
				// See opt-out guard in JSDoc above before changing this.
				unsubscribed: false,
			})
			if (!create.error) return { kind: 'ok' }
			return mapError(create.error)
		}

		const update = await resend.contacts.update({
			audienceId,
			email: contact.email,
			firstName,
			lastName,
		})
		if (!update.error) return { kind: 'ok' }
		return mapError(update.error)
	}
}
