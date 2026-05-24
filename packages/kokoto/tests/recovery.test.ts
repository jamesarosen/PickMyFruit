import { afterEach, describe, expect, it } from "vitest";
import { defineWorkflow } from "../src/workflow.server.js";
import { runtime } from "../src/runtime.server.js";
import { clearWorkflowRegistry } from "../src/registry.server.js";
import { clearQueues } from "../src/queue.server.js";
import * as store from "../src/store.server.js";
import { createTestDcDb } from "./helpers.js";

describe("recovery", () => {
	afterEach(async () => {
		await runtime.stop();
	});

	it("reclaims running workflows owned by a foreign executor on boot", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		const wf = defineWorkflow("recover", async (ctx) => {
			await ctx.step("work", async () => "ok");
			return true;
		});
		await store.insertExecutor(client, "old-executor");
		await store.insertWorkflow(client, {
			id: "wf-1",
			name: "recover",
			input: {},
		});
		await client.execute({
			sql: `UPDATE _dc_workflow SET status = 'running', executor_id = 'old-executor', started_at = ? WHERE id = 'wf-1'`,
			args: [Date.now()],
		});

		await runtime.start({ client, workflows: [wf] });
		const handle = { id: "wf-1" };
		await new Promise((r) => setTimeout(r, 100));
		runtime.wake();
		await new Promise((r) => setTimeout(r, 200));
		const row = await store.getWorkflow(client, handle.id);
		expect(row?.status).toBe("success");
	});
});
