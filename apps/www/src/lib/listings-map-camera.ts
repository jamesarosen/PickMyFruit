import { NAPA_CITY_HALL, type LocationBias } from '@/lib/geolocation'

/** Zoom used when the map centers on a single point rather than fitting listings. */
export const DEFAULT_MAP_ZOOM = 13

/** Napa City Hall in MapLibre `[lng, lat]` order — the center fallback. */
export const NAPA_CITY_HALL_LNGLAT: [lng: number, lat: number] = [
	NAPA_CITY_HALL.lng,
	NAPA_CITY_HALL.lat,
]

/** How the home map should frame itself on load. */
export type ListingsMapCamera =
	| { kind: 'center'; center: [lng: number, lat: number]; zoom: number }
	| { kind: 'fit-groups' }

/**
 * Decides how the home map frames itself: centered on the user when their
 * position is known, otherwise the existing behavior — fit the listing groups,
 * or fall back to Napa City Hall when there are none.
 */
export function planListingsMapCamera(
	hasGroups: boolean,
	userCenter: LocationBias | null | undefined
): ListingsMapCamera {
	if (userCenter) {
		return {
			kind: 'center',
			center: [userCenter.lng, userCenter.lat],
			zoom: DEFAULT_MAP_ZOOM,
		}
	}
	if (hasGroups) {
		return { kind: 'fit-groups' }
	}
	return {
		kind: 'center',
		center: NAPA_CITY_HALL_LNGLAT,
		zoom: DEFAULT_MAP_ZOOM,
	}
}
