import { createClient, type Client } from "@libsql/client";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const migrationPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"schema.sql",
);

/** Creates an isolated file-backed SQLite database with `_dc_*` tables applied. */
export async function createTestDcDb(): Promise<Client> {
	if (!existsSync(migrationPath)) {
		throw new Error(`Missing kokoto test schema at ${migrationPath}`);
	}
	const dir = mkdtempSync(join(tmpdir(), "kokoto-test-"));
	const dbPath = join(dir, "test.db");
	const client = createClient({ url: `file:${dbPath}` });
	await client.execute("PRAGMA foreign_keys = ON");
	const sql = readFileSync(migrationPath, "utf8");
	const statements = sql
		.split(/--> statement-breakpoint\n?/)
		.map((s) => s.trim())
		.filter(Boolean);
	for (const statement of statements) {
		await client.execute(statement);
	}
	const tables = await client.execute(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_dc_workflow'",
	);
	if (tables.rows.length === 0) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error("kokoto test schema migration did not create _dc_workflow");
	}
	return client;
}
