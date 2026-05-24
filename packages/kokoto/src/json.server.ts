import { DurablePayloadError } from "./errors.server.js";
import { MAX_JSON_BYTES } from "./types.server.js";

/** Serializes a value to JSON and enforces the durable payload byte cap. */
export function serializePayload(value: unknown): string {
	const json = JSON.stringify(value);
	const bytes = Buffer.byteLength(json, "utf8");
	if (bytes > MAX_JSON_BYTES) {
		throw new DurablePayloadError(
			`Payload exceeds ${MAX_JSON_BYTES} bytes (${bytes})`,
		);
	}
	return json;
}

/** Parses stored JSON or returns `undefined` when the column is null. */
export function parsePayload<T>(json: string | null): T | undefined {
	if (json == null) return undefined;
	return JSON.parse(json) as T;
}
