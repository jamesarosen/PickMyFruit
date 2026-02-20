/**
 * H3 resolution constants used across the application.
 *
 * @see {@link https://gist.github.com/colbyn/001064f00385d253b42693c3889f9beb} for
 * a table of H3 resolutions, average areas, and physical analogies.
 */
export const H3_RESOLUTIONS = {
	/** Resolution for stored coordinates — tree-level precision (~9m² edge). */
	STORAGE: 13,

	/** Resolution for grouping listings on the home page map (~5.2 km²). */
	HOME_GROUPING: 7,

	/** Resolution for public listing detail — approximate area (~0.74 km², ~Central Park). */
	PUBLIC_DETAIL: 8,

	/** Resolution for owner listing detail — near-exact location (~9m² edge). */
	OWNER_DETAIL: 13,

	/** Coarsest resolution allowed for area filtering (~12,400 km²). */
	MIN_AREA: 3,

	/** Finest resolution allowed in public-facing area queries. */
	MAX_PUBLIC_AREA: 8,

	/** Finest resolution allowed for owner-facing views. */
	MAX_OWNER_AREA: 13,
} as const

/**
 * ln(4) / ln(7) ≈ 0.7124 — the zoom-per-H3-resolution ratio.
 *
 * Each H3 resolution subdivides cell area by 7; each OSM zoom level
 * subdivides visible area by 4. The ratio converts between the two scales.
 */
const ZOOM_PER_H3_RES = Math.log(4) / Math.log(7)

/**
 * Offset calibrated so OSM zoom 13 maps to H3 resolution 8, yielding
 * ≈ 5 H3 cells in a typical map viewport (finer grouping).
 */
const ZOOM_OFFSET = 8 - ZOOM_PER_H3_RES * 13

/**
 * Maps an OSM zoom level to the H3 resolution that keeps roughly 3–20 cells
 * visible on screen. Clamped to [MIN_AREA, MAX_PUBLIC_AREA].
 */
export function zoomToH3Resolution(zoom: number): number {
	const raw = Math.round(ZOOM_PER_H3_RES * zoom + ZOOM_OFFSET)
	return Math.max(
		H3_RESOLUTIONS.MIN_AREA,
		Math.min(H3_RESOLUTIONS.MAX_PUBLIC_AREA, raw)
	)
}
