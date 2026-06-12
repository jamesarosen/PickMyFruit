/** A point used to bias location-aware lookups. */
export interface LocationBias {
	lat: number
	lng: number
}

/** Napa City Hall — the bias fallback when the user's position is unknown. */
export const NAPA_CITY_HALL: LocationBias = {
	lat: 38.2967151,
	lng: -122.292037,
}

/**
 * Asks the browser for the user's current position, resolving null on any
 * non-success outcome (denied, unavailable, timed out, API missing). Denial
 * is a normal answer, not an exception — nothing is reported or logged.
 *
 * A cached fix up to five minutes old at coarse accuracy is accepted: the
 * position only biases address lookups, which never need GPS precision.
 */
export function requestCurrentLocation(): Promise<LocationBias | null> {
	return new Promise((resolve) => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			resolve(null)
			return
		}
		navigator.geolocation.getCurrentPosition(
			(position) =>
				resolve({
					lat: position.coords.latitude,
					lng: position.coords.longitude,
				}),
			() => resolve(null),
			{
				enableHighAccuracy: false,
				maximumAge: 5 * 60_000,
				timeout: 10_000,
			}
		)
	})
}
