import { Resend } from 'resend'
import type {
	ResendClient,
	ResendContact,
} from '@/lib/resend-sync-process-row.server'

/** Splits a full name into first/last for Resend's contact fields. */
function splitName(fullName: string): { firstName: string; lastName?: string } {
	const parts = fullName.trim().split(/\s+/)
	return {
		firstName: parts[0] ?? '',
		lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
	}
}

/**
 * Creates a ResendClient that upserts a user contact into the given audience.
 *
 * IMPORTANT — opt-out guard: when a `subscribed` (or `newsletterStatus`) field
 * is added to the `user` schema, map it here as `unsubscribed: !user.subscribed`.
 * Never blindly set `unsubscribed: false` for a user who has opted out; doing so
 * re-subscribes them and violates CAN-SPAM / GDPR. Add a unit test for this path.
 */
export function createResendSyncClient(
	apiKey: string,
	audienceId: string
): ResendClient {
	const resend = new Resend(apiKey)

	return async (contact: ResendContact) => {
		const { firstName, lastName } = splitName(contact.name)

		const { error } = await resend.contacts.create({
			audienceId,
			email: contact.email,
			firstName,
			lastName,
			// See opt-out guard note in JSDoc above before changing this.
			unsubscribed: false,
		})

		if (!error) return { kind: 'ok' }

		const status = error.statusCode
		if (status === null) {
			return { kind: 'network-error', error: new Error(error.message) }
		}
		if (status >= 400 && status < 500) {
			return { kind: 'client-error', status, message: error.message }
		}
		return { kind: 'server-error', status, message: error.message }
	}
}
