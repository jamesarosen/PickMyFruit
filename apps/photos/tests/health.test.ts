import { describe, it, expect } from "vitest";
import app from "../src/index.js";

describe("GET /health", () => {
	it("returns 200 with ok, uptimeMs, and sharpVersion", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			ok: boolean;
			sharpVersion: string;
			uptimeMs: number;
		};
		expect(body).toMatchObject({
			ok: true,
			sharpVersion: expect.any(String),
			uptimeMs: expect.any(Number),
		});
		expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
	});
});
