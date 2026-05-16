import { describe, it, expect, vi } from "vitest";
import {
	createResendUpsert,
	findNewsletterTopicId,
	parseRetryAfter,
	type ResendContact,
} from "../src/resend-client";

const contact: ResendContact = {
	id: "user_1",
	email: "alice@example.com",
	name: "Alice Anderson",
	phone: null,
};

const CONTACT_ID = "c1-uuid";
const TOPIC_ID = "topic-newsletter-uuid";

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
		topicId: TOPIC_ID,
		baseUrl: "https://api.example.com",
		fetchImpl,
	};
}

describe("findNewsletterTopicId", () => {
	it("returns the Newsletter topic ID when found", async () => {
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					JSON.stringify({
						object: "list",
						has_more: false,
						data: [
							{ id: "other-id", name: "Announcements" },
							{ id: TOPIC_ID, name: "Newsletter" },
						],
					}),
					{ status: 200 },
				),
		]);

		const id = await findNewsletterTopicId({
			apiKey: "rk_test",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		expect(id).toBe(TOPIC_ID);
		expect(calls[0].url).toContain("/topics?limit=100");
	});

	it("returns null when Newsletter topic is absent", async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response(
					JSON.stringify({ object: "list", has_more: false, data: [] }),
					{ status: 200 },
				),
		]);

		const id = await findNewsletterTopicId({
			apiKey: "rk_test",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		expect(id).toBeNull();
	});

	it("returns null on a non-OK response", async () => {
		const { fetchImpl } = makeFetch([
			() => new Response("{}", { status: 401 }),
		]);

		const id = await findNewsletterTopicId({
			apiKey: "rk_test",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		expect(id).toBeNull();
	});

	it("returns null on network error", async () => {
		const fetchImpl = vi.fn(() => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		const id = await findNewsletterTopicId({
			apiKey: "rk_test",
			baseUrl: "https://api.example.com",
			fetchImpl,
		});

		expect(id).toBeNull();
	});
});

describe("createResendUpsert", () => {
	it("creates a new contact and subscribes to Newsletter topic", async () => {
		const { fetchImpl, calls } = makeFetch([
			// GET /contacts/:email → 404 (new)
			() => new Response("{}", { status: 404 }),
			// POST /contacts → 200 with id
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			// GET /contacts/:id/topics → not subscribed yet
			() =>
				new Response(
					JSON.stringify({ object: "list", has_more: false, data: [] }),
					{ status: 200 },
				),
			// PATCH /contacts/:id/topics → 200
			() => new Response(JSON.stringify({ id: TOPIC_ID }), { status: 200 }),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);

		expect(result).toEqual({ kind: "ok" });
		expect(calls).toHaveLength(4);

		const [getReq, postReq, topicsGetReq, topicsPatchReq] = calls;

		expect(getReq.method).toBe("GET");
		expect(getReq.url).toContain("/contacts/alice%40example.com");

		expect(postReq.method).toBe("POST");
		expect(postReq.url).toMatch(/\/contacts$/);
		const postBody = (await postReq.json()) as Record<string, unknown>;
		expect(postBody).toEqual({
			email: "alice@example.com",
			first_name: "Alice",
			last_name: "Anderson",
			unsubscribed: false,
		});

		expect(topicsGetReq.method).toBe("GET");
		expect(topicsGetReq.url).toContain(
			`/contacts/${CONTACT_ID}/topics?limit=100`,
		);

		expect(topicsPatchReq.method).toBe("PATCH");
		expect(topicsPatchReq.url).toContain(`/contacts/${CONTACT_ID}/topics`);
		const patchBody = (await topicsPatchReq.json()) as unknown;
		expect(patchBody).toEqual([{ id: TOPIC_ID, subscription: "opt_in" }]);
	});

	it("updates an existing contact and subscribes to Newsletter topic if absent", async () => {
		const { fetchImpl, calls } = makeFetch([
			// GET → 200 with existing contact id
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			// PATCH /contacts/:id → 200
			() => new Response("{}", { status: 200 }),
			// GET /contacts/:id/topics → not subscribed
			() =>
				new Response(
					JSON.stringify({ object: "list", has_more: false, data: [] }),
					{ status: 200 },
				),
			// PATCH /contacts/:id/topics → 200
			() => new Response(JSON.stringify({ id: TOPIC_ID }), { status: 200 }),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert({ ...contact, name: "Alice Updated" });

		expect(result).toEqual({ kind: "ok" });

		const [, patchReq] = calls;
		expect(patchReq.method).toBe("PATCH");
		expect(patchReq.url).toContain(`/contacts/${CONTACT_ID}`);
		const patchBody = (await patchReq.json()) as Record<string, unknown>;
		expect(patchBody).toEqual({ first_name: "Alice", last_name: "Updated" });
		// Critical: must not clobber an opt-out done in Resend's dashboard.
		expect(patchBody).not.toHaveProperty("unsubscribed");
	});

	it("skips topic PATCH when contact is already subscribed", async () => {
		const { fetchImpl, calls } = makeFetch([
			// GET → 200
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			// PATCH contact → 200
			() => new Response("{}", { status: 200 }),
			// GET topics → already subscribed
			() =>
				new Response(
					JSON.stringify({
						object: "list",
						has_more: false,
						data: [
							{ id: TOPIC_ID, name: "Newsletter", subscription: "opt_in" },
						],
					}),
					{ status: 200 },
				),
			// No 4th call expected
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);

		expect(result).toEqual({ kind: "ok" });
		expect(calls).toHaveLength(3);
	});

	it("preserves opt_out — skips topic PATCH when subscribed with opt_out", async () => {
		const { fetchImpl, calls } = makeFetch([
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			() => new Response("{}", { status: 200 }),
			() =>
				new Response(
					JSON.stringify({
						object: "list",
						has_more: false,
						data: [
							{ id: TOPIC_ID, name: "Newsletter", subscription: "opt_out" },
						],
					}),
					{ status: 200 },
				),
		]);

		const upsert = createResendUpsert(makeConfig(fetchImpl));
		const result = await upsert(contact);

		expect(result).toEqual({ kind: "ok" });
		// Only GET + PATCH contact + GET topics — no topic PATCH.
		expect(calls).toHaveLength(3);
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
