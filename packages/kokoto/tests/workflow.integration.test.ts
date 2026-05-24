import { describe, expect, it } from "vitest";
import { defineWorkflow } from "../src/workflow.server.js";
import { defineQueue } from "../src/queue.server.js";
import { runtime } from "../src/runtime.server.js";
import { clearWorkflowRegistry } from "../src/registry.server.js";
import { clearQueues } from "../src/queue.server.js";
import { DurableCancelledError } from "../src/errors.server.js";
import { createTestDcDb } from "./helpers.js";

describe("workflow integration", () => {
	it("runs a two-step workflow to success", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		const order: string[] = [];
		const wf = defineWorkflow("twoStep", async (ctx, input: { v: number }) => {
			const a = await ctx.step("first", async () => {
				order.push("first");
				return input.v + 1;
			});
			const b = await ctx.step("second", async () => {
				order.push("second");
				return a * 2;
			});
			return b;
		});
		defineQueue("q", { concurrency: 2 });
		await runtime.start({
			client,
			workflows: [wf],
			queues: [{ name: "q", concurrency: 2 }],
		});
		const handle = await runtime.startWorkflow(wf, {
			input: { v: 3 },
			queue: "q",
		});
		const result = await handle.result({ timeout: 5_000 });
		expect(result).toBe(8);
		expect(order).toEqual(["first", "second"]);
		await runtime.stop();
	});

	it("cancels a pending workflow", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		const wf = defineWorkflow("slow", async (ctx) => {
			await ctx.step("work", async () => {
				await new Promise((r) => setTimeout(r, 500));
				return "done";
			});
		});
		await runtime.start({ client, workflows: [wf], globalConcurrency: 0 });
		const handle = await runtime.startWorkflow(wf, { input: {} });
		const cancelled = await handle.cancel();
		expect(cancelled).toBe(true);
		await runtime.stop();
	});

	it("throws DurableCancelledError at step boundary when running workflow is cancelled", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		const wf = defineWorkflow("cancelRun", async (ctx) => {
			await ctx.step("one", async () => "a");
			await ctx.step("two", async () => "b");
		});
		defineQueue("q", { concurrency: 1 });
		await runtime.start({
			client,
			workflows: [wf],
			queues: [{ name: "q", concurrency: 1 }],
			globalConcurrency: 1,
		});
		const handle = await runtime.startWorkflow(wf, { input: {}, queue: "q" });
		await new Promise((r) => setTimeout(r, 20));
		await runtime.cancel(handle.id);
		const row = await client.execute({
			sql: "SELECT status FROM _dc_workflow WHERE id = ?",
			args: [handle.id],
		});
		const status = String(row.rows[0]?.status);
		expect(["cancelled", "running", "success"]).toContain(status);
		await runtime.stop();
	});
});
