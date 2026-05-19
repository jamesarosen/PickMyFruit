import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * On-disk shape of the cursor file. The cursor value is **opaque** to the
 * worker — only apps/www knows the underlying (updated_at, id) encoding.
 */
export const cursorFileSchema = z.object({
	cursor: z.string(),
});

export type CursorFile = z.infer<typeof cursorFileSchema>;

/** Returned when the file does not exist or is unparseable. Treated as "start over". */
export const EMPTY_CURSOR: CursorFile = { cursor: "" };

/**
 * Reads the cursor file. Missing file or invalid JSON → EMPTY_CURSOR.
 * The internal API treats an empty cursor as "from the beginning", and Resend
 * upserts are idempotent, so a corrupt-file rewind is harmless.
 */
export async function readCursorFile(path: string): Promise<CursorFile> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (err: unknown) {
		if (
			err &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code?: string }).code === "ENOENT"
		)
			return EMPTY_CURSOR;

		throw err;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return EMPTY_CURSOR;
	}

	const result = cursorFileSchema.safeParse(parsed);
	return result.success ? result.data : EMPTY_CURSOR;
}

/**
 * Atomically writes the cursor file: write to `<path>.tmp` then `rename` over
 * the target. POSIX `rename` is atomic, so a crash mid-write leaves the
 * previous cursor intact and the worker simply replays the most recent row.
 *
 * Creates any missing parent directories on first run so the worker doesn't
 * need an init script — it can land on a freshly mounted volume.
 */
export async function writeCursorFile(
	path: string,
	cursor: string,
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true });
	const tmp = `${path}.tmp`;
	const payload = JSON.stringify({ cursor } satisfies CursorFile);
	await writeFile(tmp, payload, "utf8");
	await rename(tmp, path);
}
