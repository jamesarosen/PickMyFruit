/**
 * Thin wrappers around Resend's Topics and Contact-Topics endpoints.
 *
 * - `GET  /topics`                              — organization-wide topic catalog
 * - `GET  /contacts/{email|id}/topics`          — a contact's per-topic subscription
 * - `PATCH /contacts/{email|id}/topics`         — update a contact's subscriptions
 *
 * Responses are validated with Zod. Resend may add new fields over time; the
 * schemas use the default "passthrough" behavior so unknown fields are dropped
 * but do not fail the parse.
 *
 * @see https://resend.com/docs/api-reference/topics/get-topic
 * @see https://resend.com/docs/api-reference/contacts/get-contact-topics
 * @see https://resend.com/docs/api-reference/contacts/update-contact-topics
 */

import { z } from 'zod'
import { serverEnv } from '@/lib/env.server'

const RESEND_BASE_URL = 'https://api.resend.com'

const subscriptionSchema = z.enum(['opt_in', 'opt_out'])

const topicSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullish(),
	default_subscription: subscriptionSchema,
})

const listTopicsSchema = z.object({
	data: z.array(topicSchema),
})

const contactTopicSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullish(),
	subscription: subscriptionSchema,
})

const listContactTopicsSchema = z.object({
	data: z.array(contactTopicSchema),
})

const topicUpdateSchema = z.object({
	id: z.string(),
	subscription: subscriptionSchema,
})

export type ResendTopic = z.infer<typeof topicSchema>
export type ResendContactTopic = z.infer<typeof contactTopicSchema>
export type ResendTopicUpdate = z.infer<typeof topicUpdateSchema>

class ResendApiError extends Error {
	readonly status: number
	constructor(message: string, status: number) {
		super(message)
		this.name = 'ResendApiError'
		this.status = status
	}
}

function getApiKey(): string {
	if (serverEnv.email.PROVIDER !== 'resend') {
		throw new Error('Resend topics API called with EMAIL_PROVIDER != resend')
	}
	return serverEnv.email.RESEND_API_KEY
}

async function resendFetch(
	method: 'GET' | 'PATCH',
	path: string,
	body?: unknown
): Promise<unknown> {
	const init: RequestInit = {
		method,
		headers: {
			authorization: `Bearer ${getApiKey()}`,
			'content-type': 'application/json',
		},
	}
	if (body !== undefined) init.body = JSON.stringify(body)

	const response = await fetch(`${RESEND_BASE_URL}${path}`, init)
	if (!response.ok) {
		const text = await response.text().catch(() => response.statusText)
		throw new ResendApiError(
			`Resend ${method} ${path} failed (${response.status}): ${text}`,
			response.status
		)
	}
	if (response.status === 204) return null
	return response.json()
}

/** Fetches the full topic catalog. */
export async function listTopics(): Promise<ResendTopic[]> {
	const raw = await resendFetch('GET', '/topics')
	return listTopicsSchema.parse(raw).data
}

/** Fetches per-topic subscription state for a contact, addressed by email. */
export async function listContactTopics(
	email: string
): Promise<ResendContactTopic[]> {
	const raw = await resendFetch(
		'GET',
		`/contacts/${encodeURIComponent(email)}/topics`
	)
	return listContactTopicsSchema.parse(raw).data
}

/** Updates a contact's subscription state for the given topics. */
export async function updateContactTopics(
	email: string,
	topics: ResendTopicUpdate[]
): Promise<void> {
	await resendFetch(
		'PATCH',
		`/contacts/${encodeURIComponent(email)}/topics`,
		topics.map((t) => topicUpdateSchema.parse(t))
	)
}
