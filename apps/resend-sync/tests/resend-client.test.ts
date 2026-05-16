import { describe, it, expect, vi } from "vitest";
import {
	createResendUpsert,
	parseRetryAfter,
	type ResendContact,
} from "../src/resend-client";

const contact: ResendContact = {
	id: "user_1",
	email: "alice@example.com",
	name: "Alice Anderson",
	phone: null,
};

function makeFetch(handlers: Array<(req: Request) => Response>) {
	let call = 0;
	const calls: Request[] = [];
	const fetchImpl = vi.fn((url: string | URL, init: RequestInit = {}) => {
		const headers = new Headers(init.headers as HeadersInit | undefined);
		const req = new Request(url.toString(), {
			method: init.method ?? "GET",
			headers,
			body: (init.body as BodyInit | null) ?? null,
		});
		calls.push(req);
		const handler = handlers[call];
		call++;
		if (!handler) throw new Error(`Unexpected fetch call #${call}`);
		return Promise.resolve(handler(req));
	});
	return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("createResendUpsert", () => {
	it("POSTs a new contact when GET returns 404", async () => {
		const { fetchImpl, calls } = makeFetch([
			() => new Response("{}", { status: 404 }),
			() => new Response("{}", { status: 200 }),
		]);

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert(contact);
		expect(result).toEqual({ kind: "ok" });
		expect(calls).toHaveLength(2);

		const [getReq, postReq] = calls;
		expect(getReq.method).toBe("GET");
		expect(getReq.url).toContain(
			"/audiences/aud_1/contacts/alice%40example.com",
		);
		expect(getReq.headers.get("authorization")).toBe("Bearer rk_test");

		expect(postReq.method).toBe("POST");
		expect(postReq.url).toContain("/audiences/aud_1/contacts");
		const postBody = (await postReq.json()) as Record<string, unknown>;
		expect(postBody).toEqual({
			email: "alice@example.com",
			first_name: "Alice",
			last_name: "Anderson",
			unsubscribed: false,
		});
	});

	it("PATCHes an existing contact when GET returns 200 without re-setting unsubscribed", async () => {
		const { fetchImpl, calls } = makeFetch([
			() => new Response('{"id":"c1"}', { status: 200 }),
			() => new Response("{}", { status: 200 }),
		]);

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert({ ...contact, name: "Alice Updated" });
		expect(result).toEqual({ kind: "ok" });

		const patchReq = calls[1];
		expect(patchReq.method).toBe("PATCH");
		expect(patchReq.url).toContain(
			"/audiences/aud_1/contacts/alice%40example.com",
		);
		const patchBody = (await patchReq.json()) as Record<string, unknown>;
		expect(patchBody).toEqual({ first_name: "Alice", last_name: "Updated" });
		// Critical: the PATCH must NOT include `unsubscribed` so we never clobber
		// an opt-out done in Resend's dashboard.
		expect(patchBody).not.toHaveProperty("unsubscribed");
	});

	it("returns client-error for 4xx", async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response('{"message":"invalid email"}', {
					status: 422,
					statusText: "Unprocessable",
				}),
		]);

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert({ ...contact, email: "not-an-email" });
		expect(result).toEqual({
			kind: "client-error",
			status: 422,
			message: "invalid email",
		});
	});

	it("returns server-error with parsed Retry-After for 429", async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response('{"message":"rate limited"}', {
					status: 429,
					headers: { "retry-after": "5" },
				}),
		]);

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert(contact);
		expect(result).toMatchObject({
			kind: "server-error",
			status: 429,
			retryAfterMs: 5_000,
		});
	});

	it("returns server-error for 5xx without Retry-After", async () => {
		const { fetchImpl } = makeFetch([
			() => new Response('{"message":"oops"}', { status: 503 }),
		]);

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert(contact);
		expect(result).toMatchObject({
			kind: "server-error",
			status: 503,
			retryAfterMs: null,
		});
	});

	it("returns network-error when fetch itself throws", async () => {
		const fetchImpl = vi.fn(() => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const upsert = createResendUpsert({
			apiKey: "rk_test",
			audienceId: "aud_1",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		const result = await upsert(contact);
		expect(result.kind).toBe("network-error");
	});
});

describe("parseRetryAfter", () => {
	it("parses seconds", () => {
		expect(parseRetryAfter("5")).toBe(5_000);
		expect(parseRetryAfter("0")).toBe(0);
	});

	it("parses HTTP-date", () => {
		const now = 1_700_000_000_000;
		const fiveSecondsLater = new Date(now + 5_000).toUTCString();
		expect(parseRetryAfter(fiveSecondsLater, () => now)).toBe(5_000);
	});

	it("returns null for missing or unparseable input", () => {
		expect(parseRetryAfter(null)).toBeNull();
		expect(parseRetryAfter("garbage")).toBeNull();
	});
});
