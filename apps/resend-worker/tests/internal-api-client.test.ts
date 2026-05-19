import { describe, it, expect, vi } from "vitest";
import { createInternalApiClient } from "../src/internal-api-client";

function makeFetch(response: Response | (() => Response)) {
	const calls: Request[] = [];
	const fetchImpl = vi.fn((url: string | URL, init: RequestInit = {}) => {
		calls.push(
			new Request(url.toString(), {
				method: init.method ?? "GET",
				headers: new Headers(init.headers as HeadersInit | undefined),
			}),
		);
		const r = typeof response === "function" ? response() : response;
		return Promise.resolve(r);
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

const validBody = {
	user: { id: "u1", email: "u@example.com", name: "You" },
	nextCursor: "next",
};

describe(createInternalApiClient, () => {
	it("sends x-internal-auth and parses a valid response", async () => {
		const { fetchImpl, calls } = makeFetch(
			new Response(JSON.stringify(validBody), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "super-secret-do-not-leak-32chars+",
			fetchImpl,
		});
		const result = await client("current-cursor");
		expect(result).toStrictEqual({ kind: "ok", body: validBody });
		expect(calls[0].headers.get("x-internal-auth")).toBe(
			"super-secret-do-not-leak-32chars+",
		);
		expect(calls[0].url).toContain("cursor=current-cursor");
	});

	it("omits cursor param when empty", async () => {
		const { fetchImpl, calls } = makeFetch(
			new Response(JSON.stringify(validBody), { status: 200 }),
		);
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast/",
			secret: "s",
			fetchImpl,
		});
		await client("");
		expect(calls[0].url).not.toContain("cursor=");
	});

	it("treats 404 as a client-error (so the worker stalls — bad secret)", async () => {
		const { fetchImpl } = makeFetch(new Response("Not Found", { status: 404 }));
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "s",
			fetchImpl,
		});
		const result = await client("");
		expect(result.kind).toBe("client-error");
	});

	it("treats 5xx as server-error with parsed Retry-After", async () => {
		const { fetchImpl } = makeFetch(
			new Response("down", {
				status: 503,
				headers: { "retry-after": "7" },
			}),
		);
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "s",
			fetchImpl,
		});
		const result = await client("");
		expect(result).toMatchObject({
			kind: "server-error",
			status: 503,
			retryAfterMs: 7_000,
		});
	});

	it("treats a malformed response body as server-error", async () => {
		const { fetchImpl } = makeFetch(
			new Response(JSON.stringify({ wrong: "shape" }), { status: 200 }),
		);
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "s",
			fetchImpl,
		});
		const result = await client("");
		expect(result.kind).toBe("server-error");
	});

	it("returns network-error when fetch throws", async () => {
		const fetchImpl = vi.fn(() => {
			throw new Error("boom");
		}) as unknown as typeof fetch;
		const client = createInternalApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "s",
			fetchImpl,
		});
		const result = await client("");
		expect(result.kind).toBe("network-error");
	});
});
