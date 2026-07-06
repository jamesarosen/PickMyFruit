import { polygonToCells, getHexagonAreaAvg } from 'h3-js'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

/** A rectangular map viewport in WGS84 degrees. */
export interface ViewportBounds {
	north: number
	south: number
	east: number
	west: number
}

/**
 * Web Mercator clamps latitude to ±85.0511°; viewports never legitimately
 * exceed it, and `polygonToCells` near the poles is ill-defined.
 */
export const MAX_MERCATOR_LAT = 85.0511

/**
 * Upper bound on the number of res-8 cells a single viewport query may cover.
 * Past this the viewport spans more than a metro area; with the public detail
 * cell at ~0.74 km² this is on the order of a few thousand km². Larger
 * viewports are reported as {@link ViewportCover}`'too-broad'`, and the caller
 * falls back to the "nearest listings" view (at that zoom, with a sparse global
 * dataset, "everything near the center" is the useful answer anyway).
 */
export const CELL_CAP = 12_000

/**
 * The cover of a viewport, expressed as res-8 (public detail) H3 cells so it can
 * be matched directly against the stored `listings.public_h3_index` column.
 *
 * `too-broad` means the rectangle would cover more than {@link CELL_CAP} cells;
 * matching is intentionally only ever performed at resolution 8 so that listing
 * membership can never change at a finer granularity than the public detail the
 * listing already discloses.
 */
export type ViewportCover =
	| { kind: 'cells'; cells: string[] }
	| { kind: 'too-broad' }

/** True when the bounds are finite, ordered, and within Mercator/longitude range. */
export function isValidViewport(bounds: ViewportBounds): boolean {
	const { north, south, east, west } = bounds
	if (![north, south, east, west].every(Number.isFinite)) return false
	if (south >= north) return false
	// Reject antimeridian-crossing rectangles (west > east) rather than guess a
	// split; the home map never legitimately produces one.
	if (west >= east) return false
	if (north > MAX_MERCATOR_LAT || south < -MAX_MERCATOR_LAT) return false
	if (east > 180 || west < -180) return false
	return true
}

/** Rough rectangle area in km², adequate for the cell-count guard. */
function approxAreaKm2(bounds: ViewportBounds): number {
	const { north, south, east, west } = bounds
	const midLatRad = (((north + south) / 2) * Math.PI) / 180
	const latKm = (north - south) * 111.32
	const lngKm = (east - west) * 111.32 * Math.cos(midLatRad)
	return Math.abs(latKm * lngKm)
}

/**
 * Converts a rectangular viewport into the set of res-8 H3 cells covering it.
 *
 * The result is always at {@link H3_RESOLUTIONS.PUBLIC_DETAIL} (8): membership
 * is therefore a privacy-safe predicate — it can only flip at res-8 cell
 * boundaries, never at the raw coordinate of a listing — and it matches the
 * indexed `public_h3_index` column with a plain `IN (...)`.
 */
export function viewportToCells(bounds: ViewportBounds): ViewportCover {
	if (!isValidViewport(bounds)) return { kind: 'cells', cells: [] }

	// Guard before calling polygonToCells: a continent-sized rectangle at res 8
	// would enumerate millions of cells. Estimate from area and bail early.
	const res8AreaKm2 = getHexagonAreaAvg(H3_RESOLUTIONS.PUBLIC_DETAIL, 'km2')
	if (approxAreaKm2(bounds) / res8AreaKm2 > CELL_CAP) {
		return { kind: 'too-broad' }
	}

	// h3-js polygonToCells expects [lat, lng] pairs (isGeoJson defaults to false).
	const ring: [number, number][] = [
		[bounds.south, bounds.west],
		[bounds.south, bounds.east],
		[bounds.north, bounds.east],
		[bounds.north, bounds.west],
		[bounds.south, bounds.west],
	]
	const cells = polygonToCells(ring, H3_RESOLUTIONS.PUBLIC_DETAIL)
	if (cells.length > CELL_CAP) return { kind: 'too-broad' }
	return { kind: 'cells', cells }
}
