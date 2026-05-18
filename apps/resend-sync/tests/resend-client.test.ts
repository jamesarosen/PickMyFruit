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
};

const CONTACT_ID = "c1-uuid";

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

function makeConfig(fetchImpl: typeof fetch) {
	return {
		apiKey: "rk_test",
		baseUrl: "https://api.example.com",
		fetchImpl,
	};
}

describe(createResendUpsert, () => {
	it("creates a new contact when GET returns 404", async () => {
		const { fetchImpl, calls } = makeFetch([
			// GET /contacts/:email → 404 (new)
			() => new Response("{}", { status: 404 }),
			// POST /contacts → 200 with id
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);

		expect(result).toStrictEqual({ kind: "ok" });
		expect(calls).toHaveLength(2);

		const [getReq, postReq] = calls;
		expect(getReq.method).toBe("GET");
		expect(getReq.url).toContain("/contacts/alice%40example.com");

		expect(postReq.method).toBe("POST");
		expect(postReq.url).toMatch(/\/contacts$/);
		const postBody = (await postReq.json()) as Record<string, unknown>;
		expect(postBody).toStrictEqual({
			email: "alice@example.com",
			first_name: "Alice",
			last_name: "Anderson",
			unsubscribed: false,
		});
	});

	it("updates an existing contact via PATCH /contacts/:id", async () => {
		const { fetchImpl, calls } = makeFetch([
			// GET → 200 with existing contact id
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			// PATCH /contacts/:id → 200
			() => new Response("{}", { status: 200 }),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert({ ...contact, name: "Alice Updated" });

		expect(result).toStrictEqual({ kind: "ok" });
		expect(calls).toHaveLength(2);

		const [, patchReq] = calls;
		expect(patchReq.method).toBe("PATCH");
		expect(patchReq.url).toContain(`/contacts/${CONTACT_ID}`);
		const patchBody = (await patchReq.json()) as Record<string, unknown>;
		expect(patchBody).toStrictEqual({
			first_name: "Alice",
			last_name: "Updated",
		});
		// Critical: must not clobber an opt-out done in Resend's dashboard.
		expect(patchBody).not.toHaveProperty("unsubscribed");
	});

	it("returns client-error for 4xx from GET contact", async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response('{"message":"invalid email"}', {
					status: 422,
					statusText: "Unprocessable",
				}),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert({ ...contact, email: "not-an-email" });
		expect(result).toStrictEqual({
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

		const upsert = createResendUpsert(makeConfig(fetchImpl));
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

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);
		expect(result).toMatchObject({
			kind: "server-error",
			status: 503,
			retryAfterMs: null,
		});
	});

	it("returns network-error when fetch throws on GET contact", async () => {
		const fetchImpl = vi.fn(() => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);
		expect(result.kind).toBe("network-error");
	});
});

describe(parseRetryAfter, () => {
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
