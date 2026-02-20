import { getResolution, cellToParent, isValidCell } from 'h3-js'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'

/**
 * Normalizes an area H3 index: clamps finer resolutions to the maximum public
 * area resolution and rejects cells coarser than the minimum area.
 * Returns null for invalid indices.
 */
export function normalizeArea(area: string | null): string | null {
	if (!area) return null
	if (!isValidCell(area)) return null
	const res = getResolution(area)
	if (res < H3_RESOLUTIONS.MIN_AREA) return null
	if (res > H3_RESOLUTIONS.MAX_PUBLIC_AREA) {
		return cellToParent(area, H3_RESOLUTIONS.MAX_PUBLIC_AREA)
	}
	return area
}

/** Checks whether a listing's H3 index falls within an area cell. */
export function listingMatchesArea(listingH3: string, area: string): boolean {
	const areaRes = getResolution(area)
	const listingRes = getResolution(listingH3)

	if (areaRes === listingRes) {
		return listingH3 === area
	}
	if (areaRes < listingRes) {
		// Coarser area: check if the listing is a descendant
		try {
			return cellToParent(listingH3, areaRes) === area
		} catch {
			return false
		}
	}
	// Area is finer than the listing — compare at listing resolution
	try {
		return cellToParent(area, listingRes) === listingH3
	} catch {
		return false
	}
}
