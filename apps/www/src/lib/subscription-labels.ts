/**
 * Human-readable labels for notification subscription fields.
 *
 * Radius values are approximate outer-edge distances at H3 resolution 7
 * (edge length ≈ 1.22 km). Formula: (k × 2.11 km + 1.06 km) × 0.621 mi/km,
 * rounded to the nearest mile.
 */
export const RING_SIZE_LABELS: readonly string[] = [
	'~1 mi radius',
	'~2 mi radius',
	'~3 mi radius',
	'~5 mi radius',
	'~6 mi radius',
	'~7 mi radius',
	'~9 mi radius',
]

/** Returns the human-readable radius label for a ring size value (0–6). */
export function ringRadiusLabel(ringSize: number): string {
	return RING_SIZE_LABELS[ringSize] ?? `${ringSize} rings`
}

/** Returns the distance portion of the radius label (e.g. "~3 mi" not "~3 mi radius"). */
export function ringDistanceLabel(ringSize: number): string {
	return ringRadiusLabel(ringSize).replace(' radius', '')
}
