import { cellToLatLng } from 'h3-js'
import type { PublicListing } from '@/data/listing'
import type { LocationBias } from '@/lib/geolocation'

/** Great-circle distance between two WGS84 points, in miles. */
export function haversineMiles(a: LocationBias, b: LocationBias): number {
	const R = 3958.8 // Earth radius in miles
	const toRad = (d: number) => (d * Math.PI) / 180
	const dLat = toRad(b.lat - a.lat)
	const dLng = toRad(b.lng - a.lng)
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Formats the distance from a public listing's cell to a point, in miles. */
export function milesTo(listing: PublicListing, from: LocationBias): string {
	const [lat, lng] = cellToLatLng(listing.approximateH3Index)
	const miles = haversineMiles(from, { lat, lng })
	if (miles < 0.5) return 'nearby'
	if (miles < 10) return `~${miles.toFixed(1)} mi`
	return `~${Math.round(miles)} mi`
}

/** Pluralizes a noun for a count, e.g. `plural(1, 'listing') === 'listing'`. */
export function plural(n: number, noun: string): string {
	return n === 1 ? noun : `${noun}s`
}
