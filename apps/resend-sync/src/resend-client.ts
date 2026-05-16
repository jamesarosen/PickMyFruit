/**
 * Loose dispatcher type. undici's `Agent` shape clashes with the
 * `undici-types` bundled in Node's @types, so we accept any object here and
 * pass it through to `fetch` via the non-standard `dispatcher` init field.
 */
export type ResendDispatcher = object;

/**
 * Resend Contacts upsert client.
 *
 * Resend has no native upsert. We use the documented existence check
 * (`GET /audiences/{id}/contacts/{email}`) to decide between create
 * (`POST`) and update (`PATCH`):
 *
 * - 404 from GET → `POST` a new contact with `unsubscribed: false`
 *   (matches Resend's default for fresh contacts).
 * - 200 from GET → `PATCH` with the new field values. The PATCH body
 *   intentionally omits `unsubscribed` so the user's current Resend
 *   opt-in state is preserved across syncs. **Never blindly re-subscribe
 *   a user who opted out** (CAN-SPAM / GDPR).
 *
 * When the `user` schema gains a subscription field, include it on both
 * the POST and the PATCH as `unsubscribed: !user.subscribed` so opt-outs
 * made in-app propagate to Resend.
 *
 * @see https://resend.com/docs/api-reference/contacts/get-contact
 * @see https://resend.com/docs/api-reference/contacts/create-contact
 * @see https://resend.com/docs/api-reference/contacts/update-contact
 */

export interface ResendContact {
	id: string;
	email: string;
	name: string;
	phone: string | null;
}

export type ResendUpsertResult =
	| { kind: "ok" }
	| {
			kind: "client-error";
			status: number;
			message: string;
	  }
	| {
			kind: "server-error";
			status: number;
			message: string;
			retryAfterMs: number | null;
	  }
	| { kind: "network-error"; error: Error };

export type ResendUpsert = (
	contact: ResendContact,
) => Promise<ResendUpsertResult>;

export interface ResendClientConfig {
	apiKey: string;
	audienceId: string;
	/** Base URL for the Resend API. Override in tests. */
	baseUrl?: string;
	/** undici Agent with keep-alive so a backfill reuses connections. */
	dispatcher?: ResendDispatcher;
	/** Injected for tests so we can stub HTTP without a network. */
	fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.resend.com";

interface ResendErrorBody {
	name?: string;
	message?: string;
}

function splitName(fullName: string): {
	firstName: string;
	lastName?: string;
} {
	const parts = fullName.trim().split(/\s+/);
	return {
		firstName: parts[0] ?? "",
		lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
	};
}

/** Parses an HTTP `Retry-After` value (either seconds or HTTP-date) to ms. */
export function parseRetryAfter(
	value: string | null,
	now: () => number = Date.now,
): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0)
		return Math.floor(seconds * 1_000);
	const when = Date.parse(value);
	if (Number.isFinite(when)) return Math.max(0, when - now());
	return null;
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as ResendErrorBody;
		return body.message ?? response.statusText;
	} catch {
		return response.statusText;
	}
}

function classify(response: Response, message: string): ResendUpsertResult {
	const status = response.status;
	if (status >= 400 && status < 500 && status !== 429) {
		return { kind: "client-error", status, message };
	}
	return {
		kind: "server-error",
		status,
		message,
		retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
	};
}

/**
 * Returns a function that upserts a single contact. The function is
 * idempotent — Resend upserts are safe to retry.
 */
export function createResendUpsert(config: ResendClientConfig): ResendUpsert {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const fetchImpl = config.fetchImpl ?? fetch;
	const audienceId = config.audienceId;
	const authHeader = `Bearer ${config.apiKey}`;

	async function call(
		method: "GET" | "POST" | "PATCH",
		path: string,
		body?: unknown,
	): Promise<Response> {
		const init: RequestInit = {
			method,
			headers: {
				authorization: authHeader,
				"content-type": "application/json",
			},
		};
		if (body !== undefined) init.body = JSON.stringify(body);
		if (config.dispatcher) {
			// undici's `dispatcher` is non-standard; fetch ignores it without an
			// undici-aware loader, and Node's @types/undici-types differs from the
			// installed undici. Stash via a cast — the runtime check is fine.
			(init as Record<string, unknown>).dispatcher = config.dispatcher;
		}
		return fetchImpl(`${baseUrl}${path}`, init);
	}

	return async (contact) => {
		const { firstName, lastName } = splitName(contact.name);
		const emailEncoded = encodeURIComponent(contact.email);

		let getResponse: Response;
		try {
			getResponse = await call(
				"GET",
				`/audiences/${audienceId}/contacts/${emailEncoded}`,
			);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}

		if (getResponse.status === 404) {
			let createResponse: Response;
			try {
				createResponse = await call(
					"POST",
					`/audiences/${audienceId}/contacts`,
					{
						email: contact.email,
						first_name: firstName,
						last_name: lastName,
						// See opt-out guard above before changing this.
						unsubscribed: false,
					},
				);
			} catch (err) {
				return { kind: "network-error", error: err as Error };
			}
			if (createResponse.ok) return { kind: "ok" };
			return classify(createResponse, await readErrorMessage(createResponse));
		}

		if (!getResponse.ok) {
			return classify(getResponse, await readErrorMessage(getResponse));
		}

		let patchResponse: Response;
		try {
			patchResponse = await call(
				"PATCH",
				`/audiences/${audienceId}/contacts/${emailEncoded}`,
				{
					first_name: firstName,
					last_name: lastName,
					// Intentional: PATCH must not include `unsubscribed`. Preserve the
					// user's Resend opt-in state across syncs.
				},
			);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}
		if (patchResponse.ok) return { kind: "ok" };
		return classify(patchResponse, await readErrorMessage(patchResponse));
	};
}
