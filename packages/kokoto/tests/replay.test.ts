import { afterEach, describe, expect, it } from "vitest";
import { defineWorkflow } from "../src/workflow.server.js";
import { defineQueue } from "../src/queue.server.js";
import { runtime } from "../src/runtime.server.js";
import { clearQueues } from "../src/queue.server.js";
import { clearWorkflowRegistry } from "../src/registry.server.js";
import { createTestDcDb } from "./helpers.js";

describe("step replay", () => {
	afterEach(async () => {
		await runtime.stop();
	});

	it("returns cached output without re-running the step function", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		let runs = 0;
		const wf = defineWorkflow("replayDemo", async (ctx) => {
			const value = await ctx.step("once", async () => {
				runs += 1;
				return { n: runs };
			});
			return value;
		});
		defineQueue("default", { concurrency: 2 });
		await runtime.start({
			client,
			workflows: [wf],
			queues: [{ name: "default", concurrency: 2 }],
		});
		const handle = await runtime.startWorkflow(wf, { input: {} });
		const first = await handle.result({ timeout: 5_000 });
		expect(first).toEqual({ n: 1 });
		expect(runs).toBe(1);

		await client.execute({
			sql: `UPDATE _dc_workflow SET status = 'pending', executor_id = NULL, started_at = NULL WHERE id = ?`,
			args: [handle.id],
		});
		runtime.wake();
		await handle.result({ timeout: 5_000 });
		expect(runs).toBe(1);
	});
});
