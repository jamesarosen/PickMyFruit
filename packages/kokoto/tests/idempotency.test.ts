import { describe, expect, it } from "vitest";
import { defineWorkflow } from "../src/workflow.server.js";
import { runtime } from "../src/runtime.server.js";
import { clearWorkflowRegistry } from "../src/registry.server.js";
import { clearQueues } from "../src/queue.server.js";
import { DurablePayloadError } from "../src/errors.server.js";
import { serializePayload } from "../src/json.server.js";
import { MAX_JSON_BYTES } from "../src/types.server.js";
import * as store from "../src/store.server.js";
import { createTestDcDb } from "./helpers.js";

describe("idempotency", () => {
	it("deduplicates enqueue by idempotency_key", async () => {
		clearWorkflowRegistry();
		clearQueues();
		const client = await createTestDcDb();
		const wf = defineWorkflow("dedup", async (ctx) => {
			await ctx.step("noop", async () => "ok");
			return true;
		});
		await runtime.start({ client, workflows: [wf] });
		const a = await runtime.startWorkflow(wf, {
			input: { x: 1 },
			id: "wf-a",
			idempotencyKey: "same-key",
		});
		const b = await runtime.startWorkflow(wf, {
			input: { x: 2 },
			id: "wf-b",
			idempotencyKey: "same-key",
		});
		expect(a.id).toBe(b.id);
		const rows = await client.execute("SELECT COUNT(*) AS c FROM _dc_workflow");
		expect(Number(rows.rows[0]?.c)).toBe(1);
		await runtime.stop();
	});

	it("rejects payloads over the JSON byte cap", () => {
		const big = { data: "x".repeat(MAX_JSON_BYTES) };
		expect(() => serializePayload(big)).toThrow(DurablePayloadError);
	});
});
