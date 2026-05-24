import { describe, expect, it } from "vitest";
import { defineWorkflow } from "../src/workflow.server.js";
import { defineQueue } from "../src/queue.server.js";
import { runtime } from "../src/runtime.server.js";
import { clearWorkflowRegistry } from "../src/registry.server.js";
import { clearQueues } from "../src/queue.server.js";
import { createTestDcDb } from "./helpers.js";

describe("queue concurrency", () => {
	it("runs at most two workflows concurrently when queue concurrency is 2", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		let inFlight = 0;
		let maxInFlight = 0;
		const wf = defineWorkflow("limited", async (ctx) => {
			await ctx.step("hold", async () => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await new Promise((r) => setTimeout(r, 80));
				inFlight -= 1;
				return true;
			});
		});
		defineQueue("limited", { concurrency: 2 });
		await runtime.start({
			client,
			workflows: [wf],
			queues: [{ name: "limited", concurrency: 2 }],
			globalConcurrency: 10,
		});
		const handles = await Promise.all(
			Array.from({ length: 5 }, (_, i) =>
				runtime.startWorkflow(wf, {
					input: {},
					id: `wf-${i}`,
					queue: "limited",
				}),
			),
		);
		await Promise.all(handles.map((h) => h.result({ timeout: 10_000 })));
		expect(maxInFlight).toBeLessThanOrEqual(2);
		await runtime.stop();
	});
});
