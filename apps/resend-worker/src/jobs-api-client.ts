import { claimResponseSchema, type ClaimResponse } from "./jobs-schema.js";
import { parseRetryAfter } from "./resend-client.js";

/**
 * Result type for an internal-API jobs call. Mirrors the Resend result shape
 * so the caller can branch on `kind` without special-casing the source.
 */
export type JobsApiResult<T> =
	| { kind: "ok"; body: T }
	| {
			kind: "server-error";
			status: number;
			message: string;
			retryAfterMs: number | null;
	  }
	| { kind: "client-error"; status: number; message: string }
	| { kind: "network-error"; error: Error };

export interface JobsApiClientConfig {
	baseUrl: string;
	secret: string;
	dispatcher?: object;
	fetchImpl?: typeof fetch;
}

export interface JobsApiClient {
	/** `POST /internal/v1/jobs/claim` */
	claim(input: {
		queue: string;
		workerId: string;
		leaseSeconds: number;
	}): Promise<JobsApiResult<ClaimResponse>>;
	/** `POST /internal/v1/jobs/:id/complete` */
	complete(input: {
		id: string;
		workerId: string;
	}): Promise<JobsApiResult<{ ok: boolean }>>;
	/** `POST /internal/v1/jobs/:id/fail` */
	fail(input: {
		id: string;
		workerId: string;
		error: string;
		retryInSeconds?: number;
	}): Promise<JobsApiResult<{ ok: boolean }>>;
}

async function readMessage(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return response.statusText;
	}
}

function classify(response: Response, message: string): JobsApiResult<never> {
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
}

export function createJobsApiClient(
	config: JobsApiClientConfig,
): JobsApiClient {
	const fetchImpl = config.fetchImpl ?? fetch;
	const trimmed = config.baseUrl.replace(/\/+$/, "");

	function makeInit(body: unknown): RequestInit {
		const init: RequestInit = {
			method: "POST",
			headers: {
				"x-internal-auth": config.secret,
				"content-type": "application/json",
				accept: "application/json",
			},
			body: JSON.stringify(body),
		};
		if (config.dispatcher)
			(init as Record<string, unknown>).dispatcher = config.dispatcher;
		return init;
	}

	async function send<T>(
		path: string,
		body: unknown,
		validate: (raw: unknown) => T,
	): Promise<JobsApiResult<T>> {
		let response: Response;
		try {
			response = await fetchImpl(`${trimmed}${path}`, makeInit(body));
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
			try {
				return { kind: "ok", body: validate(json) };
			} catch {
				return {
					kind: "server-error",
					status: response.status,
					message: "internal API returned an invalid response shape",
					retryAfterMs: null,
				};
			}
		}

		const message = await readMessage(response);
		return classify(response, message);
	}

	return {
		claim: (input) =>
			send("/internal/v1/jobs/claim", input, (raw) =>
				claimResponseSchema.parse(raw),
			),
		complete: ({ id, workerId }) =>
			send(
				`/internal/v1/jobs/${encodeURIComponent(id)}/complete`,
				{ workerId },
				(raw) => {
					const obj = raw as { ok?: boolean };
					return { ok: Boolean(obj.ok) };
				},
			),
		fail: ({ id, workerId, error, retryInSeconds }) =>
			send(
				`/internal/v1/jobs/${encodeURIComponent(id)}/fail`,
				{ workerId, error, retryInSeconds },
				(raw) => {
					const obj = raw as { ok?: boolean };
					return { ok: Boolean(obj.ok) };
				},
			),
	};
}
