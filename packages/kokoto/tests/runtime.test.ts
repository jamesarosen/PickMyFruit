import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	createRuntime,
	defineQueue,
	defineWorkflow,
	DurableCancelledError,
	DurablePayloadError,
	installKokotoSchema,
} from "../src/index.server.js";
import type { JsonValue } from "../src/index.server.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })),
	);
});

async function createTestClient(): Promise<Client> {
	const dir = await mkdtemp(path.join(tmpdir(), "kokoto-"));
	tempDirs.push(dir);
	const client = createClient({ url: `file:${path.join(dir, "test.db")}` });
	await installKokotoSchema(client);
	return client;
}

async function countRows(client: Client, table: string): Promise<number> {
	const result = await client.execute(`SELECT count(*) AS count FROM ${table}`);
	return Number(result.rows[0]?.count ?? 0);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Timed out waiting for condition");
}

test("deduplicates starts by idempotency key and returns the canonical handle", async () => {
	const client = await createTestClient();
	const workflow = defineWorkflow(
		"echo",
		async (_ctx, input: JsonValue) => input,
	);
	const runtime = createRuntime({ client, now: () => 1, wakeOnEnqueue: false });
	await runtime.start({ workflows: [workflow], startDispatcher: false });

	const first = await runtime.start(workflow, {
		id: "first",
		input: { ok: true },
		idempotencyKey: "same-business-event",
		runAt: 10,
	});
	const second = await runtime.start(workflow, {
		id: "second",
		input: { ok: false },
		idempotencyKey: "same-business-event",
		runAt: 10,
	});

	expect(second.id).toBe(first.id);
	expect(await countRows(client, "_dc_workflow")).toBe(1);
});

test("replays successful steps when a workflow retries", async () => {
	const client = await createTestClient();
	let stepRuns = 0;
	let bodyRuns = 0;
	const workflow = defineWorkflow("retry-replay", async (ctx) => {
		bodyRuns += 1;
		const value = await ctx.step("stable-step", () => {
			stepRuns += 1;
			return { value: 42 };
		});
		if (bodyRuns === 1) throw new Error("fail after step commit");
		return value;
	});
	const runtime = createRuntime({
		client,
		now: () => 10,
		wakeOnEnqueue: false,
	});
	await runtime.start({ workflows: [workflow], startDispatcher: false });
	const handle = await runtime.start(workflow, {
		input: null,
		maxAttempts: 2,
		runAt: 10,
	});

	await runtime.tick();
	await runtime.drain();
	await runtime.tick();
	await runtime.drain();

	await expect(handle.result({ timeoutMs: 100 })).resolves.toEqual({
		value: 42,
	});
	expect(stepRuns).toBe(1);
	expect(bodyRuns).toBe(2);
});

test("claims only available queue capacity", async () => {
	const client = await createTestClient();
	const releases: Array<() => void> = [];
	const workflow = defineWorkflow("slow", async (ctx, input: JsonValue) => {
		await ctx.step("hold", () => {
			return new Promise<JsonValue>((resolve) => {
				releases.push(() => resolve(input));
			});
		});
		return input;
	});
	const runtime = createRuntime({
		client,
		globalConcurrency: 5,
		now: () => 20,
		wakeOnEnqueue: false,
	});
	await runtime.start({
		workflows: [workflow],
		queues: [defineQueue("email", { concurrency: 2 })],
		startDispatcher: false,
	});
	for (const id of ["one", "two", "three", "four", "five"]) {
		await runtime.start(workflow, {
			id,
			input: id,
			queue: "email",
			runAt: 20,
		});
	}

	await runtime.tick();
	await waitFor(() => releases.length === 2);

	const result = await client.execute(
		"SELECT status, count(*) AS count FROM _dc_workflow GROUP BY status",
	);
	const counts = Object.fromEntries(
		result.rows.map((row) => [String(row.status), Number(row.count)]),
	);
	expect(counts).toEqual({ pending: 3, running: 2 });
	releases.splice(0).forEach((release) => release());
	await runtime.drain();
});

test("cancels a running workflow at the next step boundary", async () => {
	const client = await createTestClient();
	let releaseFirstStep!: () => void;
	const workflow = defineWorkflow("cancel-running", async (ctx) => {
		await ctx.step("first", () => {
			return new Promise<JsonValue>((resolve) => {
				releaseFirstStep = () => resolve({ first: true });
			});
		});
		await ctx.step("second", () => ({ second: true }));
		return { ok: true };
	});
	const runtime = createRuntime({
		client,
		now: () => 30,
		wakeOnEnqueue: false,
	});
	await runtime.start({ workflows: [workflow], startDispatcher: false });
	const handle = await runtime.start(workflow, { input: null, runAt: 30 });
	await runtime.tick();
	await waitFor(() => typeof releaseFirstStep === "function");

	await handle.cancel();
	releaseFirstStep();
	await runtime.drain();

	await expect(handle.result({ timeoutMs: 100 })).rejects.toBeInstanceOf(
		DurableCancelledError,
	);
});

test("recovers stale foreign running workflows on boot", async () => {
	const client = await createTestClient();
	await client.execute(
		"INSERT INTO _dc_executor (id, started_at, heartbeat_at) VALUES ('old', 1, 1)",
	);
	await client.execute({
		sql: `INSERT INTO _dc_workflow (
			id, name, status, worker_pool, input, attempts, max_attempts,
			executor_id, scheduled_for, created_at
		) VALUES (?, ?, 'running', 'node-default', ?, 1, 3, 'old', 0, 1)`,
		args: ["recover-me", "noop", "null"],
	});
	const runtime = createRuntime({
		client,
		executorId: "new",
		now: () => 10_000,
		heartbeatTimeoutMs: 1_000,
	});

	await runtime.start({ workflows: [], startDispatcher: false });

	const row = await client.execute(
		"SELECT status, executor_id FROM _dc_workflow WHERE id = 'recover-me'",
	);
	expect(row.rows[0]).toMatchObject({ status: "pending", executor_id: null });
});

test("rejects payloads over the 1 MB SQLite row budget", async () => {
	const client = await createTestClient();
	const workflow = defineWorkflow(
		"too-large",
		async (_ctx, input: JsonValue) => input,
	);
	const runtime = createRuntime({ client, wakeOnEnqueue: false });
	await runtime.start({ workflows: [workflow], startDispatcher: false });

	await expect(
		runtime.start(workflow, { input: "x".repeat(1_000_001) }),
	).rejects.toBeInstanceOf(DurablePayloadError);
});
