import { describe, it, expect, vi } from "vitest";
import { processOneJob } from "../src/process-job";
import type { JobsApiClient } from "../src/jobs-api-client";
import type { TokenBucket } from "../src/token-bucket";

vi.mock(import("../src/sentry"), () => ({
	Sentry: { captureException: vi.fn() },
}));
vi.mock(import("../src/logger"), () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const noopBucket: TokenBucket = {
	take: async () => undefined,
	honorRetryAfter: async () => undefined,
};

function makeJobsClient(
	overrides: Partial<JobsApiClient> = {},
): JobsApiClient & { calls: { complete: string[]; fail: string[] } } {
	const calls = { complete: [] as string[], fail: [] as string[] };
	const defaults: JobsApiClient = {
		claim: vi.fn(),
		complete: vi.fn(async ({ id }) => {
			calls.complete.push(id);
			return { kind: "ok", body: { ok: true } };
		}),
		fail: vi.fn(async ({ id }) => {
			calls.fail.push(id);
			return { kind: "ok", body: { ok: true } };
		}),
	};
	return { ...defaults, ...overrides, calls };
}

describe(processOneJob, () => {
	it("returns 'drained' when the API returns null", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({ kind: "ok", body: { job: null } })),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("drained");
	});

	it("dispatches a noop job and calls /complete", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "ok",
				body: {
					job: {
						id: "job-1",
						queue: "resend-email",
						data: JSON.stringify({ type: "noop" }),
						attempts: 0,
					},
				},
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("processed");
		expect(jobs.calls.complete).toStrictEqual(["job-1"]);
		expect(jobs.calls.fail).toStrictEqual([]);
	});

	it("schema-mismatch on invalid JSON fails the row permanently without crashing", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "ok",
				body: {
					job: {
						id: "job-1",
						queue: "resend-email",
						data: "not-valid-json",
						attempts: 0,
					},
				},
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("processed");
		expect(jobs.calls.fail).toStrictEqual(["job-1"]);
		expect(jobs.calls.complete).toStrictEqual([]);
		// permanent fail → no retryInSeconds
		const failMock = jobs.fail as ReturnType<typeof vi.fn>;
		const [[call]] = failMock.mock.calls;
		expect(call.error).toBe("schema-mismatch");
		expect(call.retryInSeconds).toBeUndefined();
	});

	it("schema-mismatch on a Zod-failing payload fails permanently", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "ok",
				body: {
					job: {
						id: "job-2",
						queue: "resend-email",
						// Missing required `from`, `to`, `subject`, `html` for inquiry-email.
						data: JSON.stringify({ type: "inquiry-email" }),
						attempts: 0,
					},
				},
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("processed");
		expect(jobs.calls.fail).toStrictEqual(["job-2"]);
		const failMock = jobs.fail as ReturnType<typeof vi.fn>;
		expect(failMock.mock.calls[0][0].error).toBe("schema-mismatch");
	});

	it("schema-mismatch on a valid JSON with an unknown discriminator value fails permanently", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "ok",
				body: {
					job: {
						id: "job-x",
						queue: "resend-email",
						data: JSON.stringify({ type: "this-type-does-not-exist" }),
						attempts: 0,
					},
				},
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("processed");
		expect(jobs.calls.fail).toStrictEqual(["job-x"]);
	});

	it("schema-mismatch when payload is a JSON array rather than an object", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "ok",
				body: {
					job: {
						id: "job-y",
						queue: "resend-email",
						data: JSON.stringify([1, 2, 3]),
						attempts: 0,
					},
				},
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("processed");
		expect(jobs.calls.fail).toStrictEqual(["job-y"]);
	});

	it("stalls when the claim endpoint returns a server-error", async () => {
		const jobs = makeJobsClient({
			claim: vi.fn(async () => ({
				kind: "server-error",
				status: 503,
				message: "down",
				retryAfterMs: null,
			})),
		});
		const outcome = await processOneJob({
			jobs,
			bucket: noopBucket,
			workerId: "w-1",
			leaseSeconds: 60,
			queue: "resend-email",
		});
		expect(outcome).toBe("stalled");
	});
});
