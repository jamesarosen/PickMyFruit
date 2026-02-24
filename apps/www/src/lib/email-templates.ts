import { buildUnavailableUrl } from './hmac'
import { serverEnv } from './env.server'

interface InquiryEmailData {
	ownerName: string
	ownerEmail: string
	gleanerName: string
	gleanerEmail: string
	gleanerNote?: string | null
	produceType: string
	quantity?: string | null
	listingNotes?: string | null
	plantId: number
	baseUrl: string
}

export function buildInquiryEmailSubject(data: InquiryEmailData): string {
	return `${data.gleanerName} wants your ${data.produceType}`
}

export function buildInquiryEmailHtml(data: InquiryEmailData): string {
	const unavailableUrl = buildUnavailableUrl(data.baseUrl, data.plantId)

	const quantitySection = data.quantity
		? `<p style="margin: 0 0 8px 0;"><strong>Quantity:</strong> ${escapeHtml(data.quantity)}</p>`
		: ''

	const notesSection = data.listingNotes
		? `<p style="margin: 0;"><strong>Your notes:</strong> ${escapeHtml(data.listingNotes)}</p>`
		: ''

	const gleanerNoteSection = data.gleanerNote
		? `
  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 8px 0; color: #92400e;">Message from ${escapeHtml(data.gleanerName)}</h3>
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
  <h1 style="color: #2d5016; margin-bottom: 24px;">Someone wants your ${escapeHtml(data.produceType)}!</h1>

  <p>Hi ${escapeHtml(data.ownerName)},</p>

  <p><strong>${escapeHtml(data.gleanerName)}</strong> is interested in your ${escapeHtml(data.produceType)}.</p>

  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 12px 0; color: #2d5016;">Listing Details</h3>
    <p style="margin: 0 0 8px 0;"><strong>Type:</strong> ${escapeHtml(data.produceType)}</p>
    ${quantitySection}
    ${notesSection}
  </div>

  ${gleanerNoteSection}

  <p>Simply <strong>reply to this email</strong> to get in touch with ${escapeHtml(data.gleanerName)}.</p>

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
export async function sendInquiryEmail(data: InquiryEmailData): Promise<void> {
	if (serverEnv.EMAIL_PROVIDER === 'silent') return

	if (serverEnv.EMAIL_PROVIDER === 'console') {
		console.log('\n========================================')
		console.log('INQUIRY EMAIL (EMAIL_PROVIDER=console)')
		console.log('========================================')
		console.log(`To: ${data.ownerEmail}`)
		console.log(`Reply-To: ${data.gleanerEmail}`)
		console.log(`Subject: ${buildInquiryEmailSubject(data)}`)
		console.log('----------------------------------------')
		console.log(buildInquiryEmailHtml(data))
		console.log('========================================\n')
		return
	}

	if (serverEnv.EMAIL_PROVIDER === 'resend') {
		const { Resend } = await import('resend')
		const resend = new Resend(serverEnv.RESEND_API_KEY)

		const { error } = await resend.emails.send({
			from: serverEnv.EMAIL_FROM,
			to: data.ownerEmail,
			replyTo: data.gleanerEmail,
			subject: buildInquiryEmailSubject(data),
			html: buildInquiryEmailHtml(data),
		})

		if (error) {
			throw new Error(`Email send failed: ${error.name} — ${error.message}`)
		}
		return
	}

	// All EMAIL_PROVIDER values are handled above; this is unreachable.
	throw new Error(
		`Unhandled EMAIL_PROVIDER: ${(serverEnv as { EMAIL_PROVIDER: string }).EMAIL_PROVIDER}`
	)
}
