/**
 * Loose dispatcher type. undici's `Agent` shape clashes with the
 * `undici-types` bundled in Node's @types, so we accept any object here and
 * pass it through to `fetch` via the non-standard `dispatcher` init field.
 */
export type ResendDispatcher = object;

/**
 * Resend Contacts upsert client (Topics API).
 *
 * Resend has no native upsert. We use the existence check
 * (`GET /contacts/{email}`) to decide between create (`POST`) and update
 * (`PATCH`), then ensure the contact is subscribed to the Newsletter topic:
 *
 * 1. `GET /contacts/{email}` — 404 → create, 200 → update.
 * 2a. 404: `POST /contacts` with `unsubscribed: false`. Fresh contacts default
 *     to subscribed; honour that rather than guessing the user's preference.
 * 2b. 200: `PATCH /contacts/{id}` with name fields only. The PATCH body
 *     intentionally omits `unsubscribed` so the user's current Resend opt-in
 *     state is preserved across syncs. **Never blindly re-subscribe a user who
 *     opted out** (CAN-SPAM / GDPR).
 * 3. `GET /contacts/{id}/topics` — check whether the Newsletter topic is
 *    already present (any subscription value).
 * 4. If absent: `PATCH /contacts/{id}/topics` with `[{id, subscription: "opt_in"}]`.
 *    If present: no-op — preserve the user's existing subscription state.
 *
 * When the `user` schema gains a subscription field, include it on both the
 * POST and the PATCH as `unsubscribed: !user.subscribed` so opt-outs made
 * in-app propagate to Resend.
 *
 * @see https://resend.com/docs/api-reference/contacts/get-contact
 * @see https://resend.com/docs/api-reference/contacts/create-contact
 * @see https://resend.com/docs/api-reference/contacts/update-contact
 * @see https://resend.com/docs/api-reference/contacts/get-contact-topics
 * @see https://resend.com/docs/api-reference/contacts/update-contact-topics
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

export interface ResendClientConfig extends ResendBaseConfig {
	/** The Resend topic ID to subscribe contacts to (Newsletter). */
	topicId: string;
}

const DEFAULT_BASE_URL = "https://api.resend.com";

interface ResendErrorBody {
	name?: string;
	message?: string;
}

interface ResendContactBody {
	id?: string;
}

interface ResendTopicEntry {
	id: string;
	name?: string;
}

interface ResendListBody {
	data: ResendTopicEntry[];
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
 * Fetches all Resend topics (up to 100) and returns the ID of the one named
 * "Newsletter", or `null` if not found.
 *
 * Called once at worker boot. Distinguishes config errors from transient
 * failures so the caller can choose the right exit code:
 *
 * - **Returns `null`** when Resend responds and the result is a misconfiguration
 *   we can't recover from by restarting: missing topic, 401/403 (likely the API
 *   key lacks topic-management scope), or 404 on the topics endpoint. The
 *   caller should exit with EX_CONFIG (78) so Fly does not restart in a loop.
 * - **Throws** on network errors and 5xx/429 responses — these are transient,
 *   and the caller should exit 1 so Fly's restart policy kicks in.
 *
 * @see https://resend.com/docs/api-reference/topics/list-topics
 */
export async function findNewsletterTopicId(
	config: ResendBaseConfig,
): Promise<string | null> {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const fetchImpl = config.fetchImpl ?? fetch;
	const authHeader = `Bearer ${config.apiKey}`;

	const response = await fetchImpl(
		`${baseUrl}/topics?limit=100`,
		makeInit("GET", authHeader, { dispatcher: config.dispatcher }),
	);

	if (
		response.status === 401 ||
		response.status === 403 ||
		response.status === 404
	)
		return null;
	if (!response.ok)
		throw new Error(`Resend GET /topics returned ${response.status}`);

	const body = (await response.json()) as ResendListBody;
	return body.data.find((t) => t.name === "Newsletter")?.id ?? null;
}

/**
 * Returns a function that upserts a single contact into Resend and ensures
 * they are subscribed to the Newsletter topic. The function is idempotent.
 */
export function createResendUpsert(config: ResendClientConfig): ResendUpsert {
	const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
	const fetchImpl = config.fetchImpl ?? fetch;
	const { topicId } = config;
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

		let contactId: string;

		if (getResponse.status === 404) {
			// Step 2a: new contact.
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

			const createBody = (await createResponse.json()) as ResendContactBody;
			if (!createBody.id) {
				return {
					kind: "client-error",
					status: 200,
					message: "Resend POST /contacts response missing id",
				};
			}
			contactId = createBody.id;
		} else if (!getResponse.ok)
			return classify(getResponse, await readErrorMessage(getResponse));
		else {
			// Step 2b: existing contact — parse ID then update name fields.
			const getBody = (await getResponse.json()) as ResendContactBody;
			if (!getBody.id) {
				return {
					kind: "client-error",
					status: 200,
					message: "Resend GET /contacts response missing id",
				};
			}
			contactId = getBody.id;

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
		}

		// Step 3: check existing topic subscriptions.
		let topicsResponse: Response;
		try {
			topicsResponse = await call(
				"GET",
				`/contacts/${contactId}/topics?limit=100`,
			);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}
		if (!topicsResponse.ok)
			return classify(topicsResponse, await readErrorMessage(topicsResponse));

		const topicsBody = (await topicsResponse.json()) as ResendListBody;
		const alreadySubscribed = topicsBody.data.some((t) => t.id === topicId);

		if (alreadySubscribed) {
			// Preserve existing subscription — do not overwrite opt_out with opt_in.
			return { kind: "ok" };
		}

		// Step 4: subscribe to Newsletter topic with opt_in default.
		let subscribeResponse: Response;
		try {
			subscribeResponse = await call("PATCH", `/contacts/${contactId}/topics`, [
				{ id: topicId, subscription: "opt_in" },
			]);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}
		if (subscribeResponse.ok) return { kind: "ok" };
		return classify(
			subscribeResponse,
			await readErrorMessage(subscribeResponse),
		);
	};
}
