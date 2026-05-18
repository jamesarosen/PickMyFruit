/**
 * Loose dispatcher type. undici's `Agent` shape clashes with the
 * `undici-types` bundled in Node's @types, so we accept any object here and
 * pass it through to `fetch` via the non-standard `dispatcher` init field.
 */
export type ResendDispatcher = object;

/**
 * Resend Contacts upsert client.
 *
 * Resend has no native upsert. We use the existence check
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

export interface ResendContact {
	id: string;
	email: string;
	name: string;
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

/** Shared config for all Resend API helpers. */
export interface ResendBaseConfig {
	apiKey: string;
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

interface ResendContactBody {
	id?: string;
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
	const { status } = response;
	if (status >= 400 && status < 500 && status !== 429)
		return { kind: "client-error", status, message };

	return {
		kind: "server-error",
		status,
		message,
		retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
	};
}

function makeInit(
	method: string,
	authHeader: string,
	options: { dispatcher?: ResendDispatcher; body?: unknown } = {},
): RequestInit {
	const init: RequestInit = {
		method,
		headers: {
			authorization: authHeader,
			"content-type": "application/json",
		},
	};
	if (options.body !== undefined) init.body = JSON.stringify(options.body);
	if (options.dispatcher) {
		// undici's `dispatcher` is non-standard; fetch ignores it without an
		// undici-aware loader, and Node's @types/undici-types differs from the
		// installed undici. Stash via a cast — the runtime check is fine.
		(init as Record<string, unknown>).dispatcher = options.dispatcher;
	}
	return init;
}

/**
 * Returns a function that upserts a single contact into Resend. The function
 * is idempotent.
 */
export function createResendUpsert(config: ResendBaseConfig): ResendUpsert {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const fetchImpl = config.fetchImpl ?? fetch;
	const authHeader = `Bearer ${config.apiKey}`;

	async function call(
		method: "GET" | "POST" | "PATCH",
		path: string,
		body?: unknown,
	): Promise<Response> {
		return fetchImpl(
			`${baseUrl}${path}`,
			makeInit(method, authHeader, { dispatcher: config.dispatcher, body }),
		);
	}

	return async (contact) => {
		const { firstName, lastName } = splitName(contact.name);
		const emailEncoded = encodeURIComponent(contact.email);

		// Step 1: existence check.
		let getResponse: Response;
		try {
			getResponse = await call("GET", `/contacts/${emailEncoded}`);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}

		if (getResponse.status === 404) {
			// Step 2a: new contact. Resend opts new contacts into the Newsletter
			// topic by default, so we don't manage topics here.
			let createResponse: Response;
			try {
				createResponse = await call("POST", "/contacts", {
					email: contact.email,
					first_name: firstName,
					last_name: lastName,
					// See opt-out guard above before changing this.
					unsubscribed: false,
				});
			} catch (err) {
				return { kind: "network-error", error: err as Error };
			}
			if (!createResponse.ok)
				return classify(createResponse, await readErrorMessage(createResponse));
			return { kind: "ok" };
		}

		if (!getResponse.ok)
			return classify(getResponse, await readErrorMessage(getResponse));

		// Step 2b: existing contact — parse ID then update name fields.
		const getBody = (await getResponse.json()) as ResendContactBody;
		if (!getBody.id) {
			return {
				kind: "client-error",
				status: 200,
				message: "Resend GET /contacts response missing id",
			};
		}
		const contactId = getBody.id;

		let patchResponse: Response;
		try {
			patchResponse = await call("PATCH", `/contacts/${contactId}`, {
				first_name: firstName,
				last_name: lastName,
				// Intentional: PATCH must not include `unsubscribed`. Preserve the
				// user's Resend opt-in state across syncs.
			});
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}
		if (!patchResponse.ok)
			return classify(patchResponse, await readErrorMessage(patchResponse));
		return { kind: "ok" };
	};
}
