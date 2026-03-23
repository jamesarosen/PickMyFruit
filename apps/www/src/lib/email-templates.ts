import { buildUnavailableUrl } from './hmac'
import { serverEnv } from './env.server'
import { logger } from './logger.server'

interface InquiryEmailData {
	baseUrl: string
	gleaner: {
		name: string
		email: string
	}
	gleanerNote?: string | null
	listing: {
		id: number
		notes?: string | null
		type: string
		quantity: string | null
	}
	owner: {
		name: string
		email: string
	}
	unavailableUrl: string
}

export function buildInquiryEmailSubject(data: InquiryEmailData): string {
	return `${data.gleaner.name} wants your ${data.listing.type}`
}

export function buildInquiryEmailHtml(data: InquiryEmailData): string {
	const { unavailableUrl } = data

	const quantitySection = data.listing.quantity
		? `<p style="margin: 0 0 8px 0;"><strong>Quantity:</strong> ${escapeHtml(data.listing.quantity)}</p>`
		: ''

	const notesSection = data.listing.notes
		? `<p style="margin: 0;"><strong>Your notes:</strong> ${escapeHtml(data.listing.notes)}</p>`
		: ''

	const gleanerNoteSection = data.gleanerNote
		? `
  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 8px 0; color: #92400e;">Message from ${escapeHtml(data.gleaner.name)}</h3>
    <p style="margin: 0;">${escapeHtml(data.gleanerNote)}</p>
  </div>
  `
		: ''

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2d5016; margin-bottom: 24px;">Someone wants your ${escapeHtml(data.listing.type)}!</h1>

  <p>Hi ${escapeHtml(data.owner.name)},</p>

  <p><strong>${escapeHtml(data.gleaner.name)}</strong> is interested in your ${escapeHtml(data.listing.type)}.</p>

  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 12px 0; color: #2d5016;">Listing Details</h3>
    <p style="margin: 0 0 8px 0;"><strong>Type:</strong> ${escapeHtml(data.listing.type)}</p>
    ${quantitySection}
    ${notesSection}
  </div>

  ${gleanerNoteSection}

  <p>Simply <strong>reply to this email</strong> to get in touch with ${escapeHtml(data.gleaner.name)}.</p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

  <p style="color: #666; font-size: 14px;">
    All done with this listing?
    <a href="${unavailableUrl}" style="color: #4a7c23;">Mark as unavailable</a>
    (link expires in 7 days)
  </p>
</body>
</html>`
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;')
}

/** Sends an inquiry notification email. Throws on failure. */
export async function sendInquiryEmail(
	input: Omit<InquiryEmailData, 'unavailableUrl'>
): Promise<void> {
	const data: InquiryEmailData = {
		...input,
		unavailableUrl: buildUnavailableUrl(input.baseUrl, input.listing.id),
	}

	if (serverEnv.email.PROVIDER === 'silent') return

	if (serverEnv.email.PROVIDER === 'console') {
		/**
		 * `data` contains sensitive information, only some of which is covered by
		 * our centralized redaction policy. This is intentional. We need the
		 * signed URL in development. This email strategy can't be used in
		 * production anyway.
		 * @todo consider replacing with Mailpit or similar for local dev
		 */
		logger.info(data, 'Inquiry email (EMAIL_PROVIDER=console)')
		return
	}

	if (serverEnv.email.PROVIDER === 'resend') {
		const { Resend } = await import('resend')
		const resend = new Resend(serverEnv.email.RESEND_API_KEY)

		const { error } = await resend.emails.send({
			from: serverEnv.EMAIL_FROM,
			to: data.owner.email,
			replyTo: data.gleaner.email,
			subject: buildInquiryEmailSubject(data),
			html: buildInquiryEmailHtml(data),
		})

		if (error) {
			throw new Error(`Email send failed: ${error.name} — ${error.message}`)
		}
		return
	}

	// All EMAIL_PROVIDER values are handled above; this is unreachable.
	throw new Error(`Unhandled EMAIL_PROVIDER: ${serverEnv.email.PROVIDER}`)
}
