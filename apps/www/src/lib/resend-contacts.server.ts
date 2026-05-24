/**
 * Resend Contacts upsert.
 *
 * Resend has no native upsert, so we use the existence check
 * (`GET /contacts/{email}`) to decide between create (`POST`) and update
 * (`PATCH`):
 *
 * 1. `GET /contacts/{email}` — 404 → create, 200 → update.
 * 2a. 404: `POST /contacts` with `unsubscribed: false`. Fresh contacts default
 *     to subscribed; honour that rather than guessing the user's preference.
 * 2b. 200: `PATCH /contacts/{id}` with name fields only. The PATCH body
 *     intentionally omits `unsubscribed` so the user's current Resend opt-in
 *     state is preserved across syncs. **Never blindly re-subscribe a user who
 *     opted out** (CAN-SPAM / GDPR).
 *
 * Topic subscription (e.g. the Newsletter topic) is handled by Resend's own
 * default-opt-in semantics on contact create, so we don't manage it here.
 * When the `user` schema gains a subscription field, include it on both the
 * POST and the PATCH as `unsubscribed: !user.subscribed` so opt-outs made
 * in-app propagate to Resend.
 *
 * @see https://resend.com/docs/api-reference/contacts/get-contact
 * @see https://resend.com/docs/api-reference/contacts/create-contact
 * @see https://resend.com/docs/api-reference/contacts/update-contact
 */

import { serverEnv } from '@/lib/env.server'

export interface ResendContact {
	email: string
	name: string
}

export type ResendUpsertResult =
	| { kind: 'ok' }
	| { kind: 'client-error'; status: number; message: string }
	| {
			kind: 'server-error'
			status: number
			message: string
			retryAfterMs: number | null
	  }
	| { kind: 'network-error'; error: Error }

export interface ResendUpsertConfig {
	apiKey: string
	baseUrl?: string
	fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://api.resend.com'

interface ResendErrorBody {
	name?: string
	message?: string
}

interface ResendContactBody {
	id?: string
}

function splitName(fullName: string): {
	firstName: string
	lastName?: string
} {
	const parts = fullName.trim().split(/\s+/)
	return {
		firstName: parts[0] ?? '',
		lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
	}
}

/** Parses an HTTP `Retry-After` value (either seconds or HTTP-date) to ms. */
export function parseRetryAfter(
	value: string | null,
	now: () => number = Date.now
): number | null {
	if (!value) return null
	const seconds = Number(value)
	if (Number.isFinite(seconds) && seconds >= 0)
		return Math.floor(seconds * 1_000)
	const when = Date.parse(value)
	if (Number.isFinite(when)) return Math.max(0, when - now())
	return null
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as ResendErrorBody
		return body.message ?? response.statusText
	} catch {
		return response.statusText
	}
}

function classify(response: Response, message: string): ResendUpsertResult {
	const { status } = response
	if (status >= 400 && status < 500 && status !== 429) {
		return { kind: 'client-error', status, message }
	}
	return {
		kind: 'server-error',
		status,
		message,
		retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
	}
}

/**
 * Build an upserter bound to the given Resend credentials. The returned
 * function is idempotent at the Resend API level — calling it repeatedly with
 * the same contact converges to the same remote state.
 */
export function createResendContactUpsert(
	config: ResendUpsertConfig
): (contact: ResendContact) => Promise<ResendUpsertResult> {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
	const fetchImpl = config.fetchImpl ?? fetch
	const authHeader = `Bearer ${config.apiKey}`

	async function call(
		method: 'GET' | 'POST' | 'PATCH',
		path: string,
		body?: unknown
	): Promise<Response> {
		const init: RequestInit = {
			method,
			headers: {
				authorization: authHeader,
				'content-type': 'application/json',
			},
		}
		if (body !== undefined) init.body = JSON.stringify(body)
		return fetchImpl(`${baseUrl}${path}`, init)
	}

	return async (contact) => {
		const { firstName, lastName } = splitName(contact.name)
		const emailEncoded = encodeURIComponent(contact.email)

		let getResponse: Response
		try {
			getResponse = await call('GET', `/contacts/${emailEncoded}`)
		} catch (err) {
			return { kind: 'network-error', error: err as Error }
		}

		if (getResponse.status === 404) {
			let createResponse: Response
			try {
				createResponse = await call('POST', '/contacts', {
					email: contact.email,
					first_name: firstName,
					last_name: lastName,
					// See opt-out guard above before changing this.
					unsubscribed: false,
				})
			} catch (err) {
				return { kind: 'network-error', error: err as Error }
			}
			if (!createResponse.ok) {
				return classify(createResponse, await readErrorMessage(createResponse))
			}
			return { kind: 'ok' }
		}

		if (!getResponse.ok) {
			return classify(getResponse, await readErrorMessage(getResponse))
		}

		const getBody = (await getResponse.json()) as ResendContactBody
		if (!getBody.id) {
			return {
				kind: 'client-error',
				status: 200,
				message: 'Resend GET /contacts response missing id',
			}
		}

		let patchResponse: Response
		try {
			patchResponse = await call('PATCH', `/contacts/${getBody.id}`, {
				first_name: firstName,
				last_name: lastName,
				// Intentional: PATCH must not include `unsubscribed`. Preserve the
				// user's Resend opt-in state across syncs.
			})
		} catch (err) {
			return { kind: 'network-error', error: err as Error }
		}
		if (!patchResponse.ok) {
			return classify(patchResponse, await readErrorMessage(patchResponse))
		}
		return { kind: 'ok' }
	}
}

/**
 * Convenience: build an upserter using the host app's configured Resend API
 * key (`env.email.RESEND_API_KEY`). Throws synchronously when the email
 * provider is not `resend` — callers should gate on
 * `serverEnv.email.PROVIDER === 'resend'` first.
 */
export function getDefaultResendContactUpsert(): (
	contact: ResendContact
) => Promise<ResendUpsertResult> {
	if (serverEnv.email.PROVIDER !== 'resend') {
		throw new Error(
			'getDefaultResendContactUpsert called with EMAIL_PROVIDER != resend'
		)
	}
	return createResendContactUpsert({ apiKey: serverEnv.email.RESEND_API_KEY })
}
