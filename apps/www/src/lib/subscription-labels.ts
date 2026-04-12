/** Maps H3 ring size to a human-readable approximate radius label. */
export const RING_SIZE_LABELS: Record<number, string> = {
	0: '~1 mile',
	1: '~3 miles',
	2: '~6 miles',
	3: '~10 miles',
	4: '~15 miles',
	5: '~20 miles',
	6: '~30 miles',
}

/** Maps throttle period values to display labels. */
export const THROTTLE_PERIOD_LABELS: Record<string, string> = {
	immediately: 'Immediately (within ~1 hour)',
	weekly: 'Weekly digest',
}

/**
 * Maps a subscription ring size (0–6) to the H3 resolution appropriate for
 * its radius. Finer resolution = more cells = more precise location.
 */
export function resolutionForRingSize(ringSize: number): number {
	if (ringSize === 0) {
		return 8
	}
	if (ringSize <= 2) {
		return 7
	}
	return 6
}
