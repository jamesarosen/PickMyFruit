import {
	internalUsersNextResponseSchema,
	type InternalUsersNextResponse,
} from "./internal-api-schema.js";
import { parseRetryAfter } from "./resend-client.js";

/**
 * Result type for an internal-API fetch. Mirrors the Resend result shape so
 * `processOneRow` can branch on `kind` without special-casing the source.
 */
export type InternalApiResult =
	| { kind: "ok"; body: InternalUsersNextResponse }
	| {
			kind: "server-error";
			status: number;
			message: string;
			retryAfterMs: number | null;
	  }
	| { kind: "client-error"; status: number; message: string }
	| { kind: "network-error"; error: Error };

export interface InternalApiClientConfig {
	baseUrl: string;
	secret: string;
	dispatcher?: object;
	fetchImpl?: typeof fetch;
}

export type InternalApiClient = (cursor: string) => Promise<InternalApiResult>;

/** GET /internal/v1/users/next?cursor=… over Fly's private network. */
export function createInternalApiClient(
	config: InternalApiClientConfig,
): InternalApiClient {
	const fetchImpl = config.fetchImpl ?? fetch;
	const trimmed = config.baseUrl.replace(/\/+$/, "");

	return async (cursor) => {
		const init: RequestInit = {
			method: "GET",
			headers: {
				"x-internal-auth": config.secret,
				accept: "application/json",
			},
		};
		if (config.dispatcher)
			(init as Record<string, unknown>).dispatcher = config.dispatcher;

		const params = new URLSearchParams();
		if (cursor) params.set("cursor", cursor);
		const url = `${trimmed}/internal/v1/users/next${
			params.toString() ? `?${params}` : ""
		}`;

		let response: Response;
		try {
			response = await fetchImpl(url, init);
		} catch (err) {
			return { kind: "network-error", error: err as Error };
		}

		if (response.ok) {
			let json: unknown;
			try {
				json = await response.json();
			} catch (err) {
				return { kind: "network-error", error: err as Error };
			}
			const parsed = internalUsersNextResponseSchema.safeParse(json);
			if (!parsed.success) {
				return {
					kind: "server-error",
					status: response.status,
					message: "internal API returned an invalid response shape",
					retryAfterMs: null,
				};
			}
			return { kind: "ok", body: parsed.data };
		}

		const message = await readMessage(response);
		if (
			response.status >= 400 &&
			response.status < 500 &&
			response.status !== 429
		)
			return { kind: "client-error", status: response.status, message };

		return {
			kind: "server-error",
			status: response.status,
			message,
			retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
		};
	};
}

async function readMessage(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return response.statusText;
	}
}
