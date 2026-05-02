/**
 * UUIDv7 regex: standard UUID format where the 13th hex digit (version nibble)
 * is exactly `7`. Example: `01970000-0000-7000-8000-000000000000`.
 */
const UUIDV7_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns true when `id` matches the UUIDv7 format. */
export function isValidPhotoId(id: string): boolean {
	return UUIDV7_RE.test(id);
}
