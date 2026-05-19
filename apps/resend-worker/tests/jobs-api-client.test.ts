import { describe, it, expect, vi } from "vitest";
import { createJobsApiClient } from "../src/jobs-api-client";

function makeFetch(queue: Array<Response | (() => Response)>): {
	fetchImpl: typeof fetch;
	calls: Array<{ url: string; body: string }>;
} {
	const calls: Array<{ url: string; body: string }> = [];
	let i = 0;
	const fetchImpl = vi.fn((url: string | URL, init: RequestInit = {}) => {
		calls.push({
			url: url.toString(),
			body: (init.body as string) ?? "",
		});
		const entry = queue[i++];
		const r = typeof entry === "function" ? entry() : entry;
		return Promise.resolve(r);
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

describe(createJobsApiClient, () => {
	it("posts to /claim with auth + body and parses the response", async () => {
		const { fetchImpl, calls } = makeFetch([
			ok({
				job: {
					id: "job-1",
					queue: "resend-email",
					data: '{"type":"noop"}',
					attempts: 0,
				},
			}),
		]);
		const client = createJobsApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "super-secret-do-not-leak-32chars+",
			fetchImpl,
		});

		const result = await client.claim({
			queue: "resend-email",
			workerId: "w-1",
			leaseSeconds: 60,
		});

		expect(result.kind).toBe("ok");
		if (result.kind !== "ok") return;
		expect(result.body.job?.id).toBe("job-1");
		expect(calls[0].url).toBe(
			"http://pickmyfruit.flycast/internal/v1/jobs/claim",
		);
		expect(JSON.parse(calls[0].body)).toStrictEqual({
			queue: "resend-email",
			workerId: "w-1",
			leaseSeconds: 60,
		});
	});

	it("returns server-error when the response shape is invalid", async () => {
		const { fetchImpl } = makeFetch([ok({ wat: true })]);
		const client = createJobsApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "super-secret-do-not-leak-32chars+",
			fetchImpl,
		});
		const result = await client.claim({
			queue: "resend-email",
			workerId: "w-1",
			leaseSeconds: 60,
		});
		expect(result.kind).toBe("server-error");
	});

	it("classifies 5xx as server-error and 4xx as client-error", async () => {
		const { fetchImpl } = makeFetch([
			new Response("down", { status: 503 }),
			new Response("bad", { status: 400 }),
		]);
		const client = createJobsApiClient({
			baseUrl: "http://pickmyfruit.flycast",
			secret: "super-secret-do-not-leak-32chars+",
			fetchImpl,
		});

		const a = await client.complete({ id: "job-1", workerId: "w-1" });
		expect(a.kind).toBe("server-error");
		const b = await client.fail({ id: "job-1", workerId: "w-1", error: "x" });
		expect(b.kind).toBe("client-error");
	});

	it("urlencodes the id in the path", async () => {
		const { fetchImpl, calls } = makeFetch([ok({ ok: true })]);
		const client = createJobsApiClient({
			baseUrl: "http://pickmyfruit.flycast/",
			secret: "super-secret-do-not-leak-32chars+",
			fetchImpl,
		});
		await client.complete({ id: "job/with/slashes", workerId: "w-1" });
		expect(calls[0].url).toBe(
			"http://pickmyfruit.flycast/internal/v1/jobs/job%2Fwith%2Fslashes/complete",
		);
	});
});
