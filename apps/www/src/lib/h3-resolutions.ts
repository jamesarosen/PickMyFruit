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
