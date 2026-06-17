import { createEffect, on } from 'solid-js'
import type { PublicListing } from '@/data/queries.server'
import { cellToLatLng, cellToBoundary, cellToParent } from 'h3-js'
import { H3_RESOLUTIONS, zoomToH3Resolution } from '@/lib/h3-resolutions'
import { PRODUCE_STAND_SLUG } from '@/lib/produce-types'
import type { LocationBias } from '@/lib/geolocation'
import type { ViewportBounds } from '@/lib/h3-viewport'
import {
	DEFAULT_MAP_ZOOM,
	planListingsMapCamera,
} from '@/lib/listings-map-camera'
import { Sentry } from '@/lib/sentry'
import MapLibreGL, {
	MapLibreGLReadyArgs,
	reportMapLoadedOnce,
} from '@/components/MapLibreGL'
import '@/components/ListingsMap.css'

/** A group of listings sharing the same approximate H3 cell. */
export interface ListingGroup {
	h3Index: string
	center: [lng: number, lat: number]
	listings: PublicListing[]
}

/** Debounce before reporting a settled viewport, so a drag emits once. */
export const VIEWPORT_DEBOUNCE_MS = 400

// MapLibre paint properties require literal color strings, not CSS variables.
const COLOR_DEFAULT = '#10b981' // --color-fresh-green
const COLOR_LABEL = '#ffffff'

// Lucide `Store` icon, inlined so it can be dropped into a MapLibre HTML marker
// without rendering a Solid component into a detached node. Placeholder pick —
// see docs/0010; `ShoppingBasket` is the non-commercial alternative.
const STORE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/><path d="M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"/></svg>`

/** True when a listing is a community produce stand. */
function isStand(listing: PublicListing): boolean {
	return listing.type === PRODUCE_STAND_SLUG
}

/** Groups public listings by their H3 parent cell at the given resolution. */
export function groupByH3(
	listings: PublicListing[],
	resolution: number = H3_RESOLUTIONS.HOME_GROUPING
): ListingGroup[] {
	const groups = new Map<string, PublicListing[]>()
	for (const listing of listings) {
		const key = cellToParent(listing.approximateH3Index, resolution)
		const arr = groups.get(key)
		if (arr) {
			arr.push(listing)
		} else {
			groups.set(key, [listing])
		}
	}
	return Array.from(groups, ([h3Index, listings]) => {
		const [lat, lng] = cellToLatLng(h3Index)
		return { h3Index, center: [lng, lat] as [number, number], listings }
	})
}

/** Builds a closed GeoJSON polygon ring from an H3 cell index. */
function h3ToPolygonCoordinates(h3Index: string): number[][] {
	// cellToBoundary returns [lat, lng] pairs; convert to [lng, lat] for GeoJSON
	const ring = cellToBoundary(h3Index).map(([lat, lng]) => [lng, lat])
	ring.push(ring[0]) // close the ring
	return ring
}

interface Props {
	listings: PublicListing[]
	/**
	 * The user's geolocated position, when known. The map centers here instead
	 * of fitting the listing bounds; undefined/null keeps the default framing.
	 */
	center?: LocationBias | null
	/**
	 * Called (debounced) when the user settles the map on a new viewport, so the
	 * page can fetch the listings now in view.
	 */
	onViewportChange?: (bounds: ViewportBounds) => void
}

/** Map showing nearby listings grouped by H3 cell. */
export default function ListingsMap(props: Props) {
	let map: import('maplibre-gl').Map | undefined
	let maplibreglRef: typeof import('maplibre-gl') | undefined
	let layersReady = false
	let currentRes: number = H3_RESOLUTIONS.HOME_GROUPING
	let standMarkers: import('maplibre-gl').Marker[] = []
	let viewportTimer: ReturnType<typeof setTimeout> | undefined

	/**
	 * Renders a distinct Store marker for each produce stand so stands are
	 * discoverable *as* stands, on top of the numeric cluster circles.
	 */
	function refreshStandMarkers() {
		for (const marker of standMarkers) marker.remove()
		standMarkers = []
		const maplibregl = maplibreglRef
		if (!map || !maplibregl) return
		for (const listing of props.listings) {
			if (!isStand(listing)) continue
			let lat: number
			let lng: number
			try {
				;[lat, lng] = cellToLatLng(listing.approximateH3Index)
			} catch (err) {
				Sentry.captureException(err)
				continue
			}
			const el = document.createElement('div')
			el.className = 'stand-marker'
			el.setAttribute('role', 'img')
			el.setAttribute('aria-label', 'Community produce stand')
			el.innerHTML = STORE_ICON_SVG
			standMarkers.push(
				new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
			)
		}
	}

	/**
	 * Mirrors the live camera onto `data-map-center` (`lng,lat`) and
	 * `data-map-zoom` — non-secret observability the end-to-end tests assert
	 * against.
	 */
	function reportCenter(container: HTMLDivElement) {
		if (!map) return
		const center = map.getCenter()
		container.dataset.mapCenter = `${center.lng.toFixed(5)},${center.lat.toFixed(5)}`
		container.dataset.mapZoom = map.getZoom().toFixed(2)
	}

	/**
	 * Debounced emit of the settled viewport. `getBounds()` is reliable as soon
	 * as the camera is set (it doesn't need tiles to load), so we emit for the
	 * initial framing too — that first query is what swaps the loader's nearest
	 * listings over to the actual in-view set.
	 */
	function scheduleViewportEmit() {
		if (!props.onViewportChange) return
		if (viewportTimer) clearTimeout(viewportTimer)
		viewportTimer = setTimeout(() => {
			if (!map) return
			const b = map.getBounds()
			props.onViewportChange?.({
				north: b.getNorth(),
				south: b.getSouth(),
				east: b.getEast(),
				west: b.getWest(),
			})
		}, VIEWPORT_DEBOUNCE_MS)
	}

	function setupMap({ container, maplibregl, onMapLoad }: MapLibreGLReadyArgs) {
		maplibreglRef = maplibregl
		const groups = groupByH3(props.listings)
		const camera = planListingsMapCamera(groups.length > 0, props.center)

		let bounds: import('maplibre-gl').LngLatBounds | undefined
		if (camera.kind === 'fit-groups') {
			bounds = new maplibregl.LngLatBounds()
			for (const group of groups) {
				bounds.extend(group.center)
			}
		}

		map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			bounds,
			center: camera.kind === 'center' ? camera.center : undefined,
			zoom: camera.kind === 'center' ? camera.zoom : undefined,
			fitBoundsOptions: { padding: 60, maxZoom: 14 },
			attributionControl: false,
		})

		reportCenter(container)
		map.on('moveend', () => {
			reportCenter(container)
			scheduleViewportEmit()
		})
		// Emit once for the initial framing so the grid reflects the actual
		// viewport even if no `moveend` fires (e.g. the camera was set directly).
		scheduleViewportEmit()

		map.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			'bottom-right'
		)
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }))

		// Markers are DOM overlays positioned by the map; they don't need the
		// tile style or any layers, so render them immediately rather than waiting
		// for the (network-dependent) `load` event.
		refreshStandMarkers()

		reportMapLoadedOnce(map, onMapLoad, () => {
			addGroupLayers(groups)
			layersReady = true

			// Adjust resolution to match the map's initial zoom
			if (!map) return
			const initialRes = zoomToH3Resolution(map.getZoom())
			if (initialRes !== currentRes) {
				currentRes = initialRes
				updateGroupSource(groupByH3(props.listings, currentRes))
			}
		})

		map.on('zoomend', () => {
			if (!layersReady || !map) return
			const newRes = zoomToH3Resolution(map.getZoom())
			if (newRes === currentRes) return
			currentRes = newRes
			updateGroupSource(groupByH3(props.listings, currentRes))
		})

		return () => {
			if (viewportTimer) clearTimeout(viewportTimer)
			for (const marker of standMarkers) marker.remove()
			standMarkers = []
			maplibreglRef = undefined
			map?.remove()
			map = undefined
		}
	}

	/** Converts listing groups to a GeoJSON FeatureCollection for MapLibre. */
	function groupsToGeoJSON(groups: ListingGroup[]): GeoJSON.FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: groups.map((g) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: g.center },
				properties: {
					h3Index: g.h3Index,
					count: g.listings.length,
					label: String(g.listings.length),
				},
			})),
		}
	}

	/** Replaces the listing-groups source data with new groups. */
	function updateGroupSource(groups: ListingGroup[]) {
		if (!map || !layersReady) return
		const source = map.getSource('listing-groups') as
			| import('maplibre-gl').GeoJSONSource
			| undefined
		if (!source) return
		source.setData(groupsToGeoJSON(groups))
	}

	function addGroupLayers(groups: ListingGroup[]) {
		if (!map) return

		map.addSource('listing-groups', {
			type: 'geojson',
			data: groupsToGeoJSON(groups),
		})

		map.addLayer({
			id: 'listing-groups-circle',
			type: 'circle',
			source: 'listing-groups',
			paint: {
				'circle-radius': [
					'interpolate',
					['linear'],
					['get', 'count'],
					1,
					16,
					10,
					28,
				],
				'circle-color': COLOR_DEFAULT,
				'circle-stroke-width': 2,
				'circle-stroke-color': COLOR_LABEL,
			},
		})

		map.addLayer({
			id: 'listing-groups-label',
			type: 'symbol',
			source: 'listing-groups',
			layout: {
				'text-field': ['get', 'label'],
				'text-size': 13,
				'text-font': ['Noto Sans Bold'],
				'text-allow-overlap': true,
			},
			paint: {
				'text-color': COLOR_LABEL,
			},
		})

		// Clicking a cluster zooms into its cell so the listings it represents
		// come into view; the resulting `moveend` re-queries the viewport.
		map.on('click', 'listing-groups-circle', (e) => {
			const feature = e.features?.[0]
			if (!feature || !map || !maplibreglRef) return
			const clickedH3 = feature.properties?.h3Index
			if (typeof clickedH3 !== 'string') return
			try {
				const ring = h3ToPolygonCoordinates(clickedH3)
				const cellBounds = new maplibreglRef.LngLatBounds()
				for (const [lng, lat] of ring) cellBounds.extend([lng, lat])
				map.fitBounds(cellBounds, { padding: 80, maxZoom: 15 })
			} catch (err) {
				Sentry.captureException(err)
			}
		})

		map.on('mouseenter', 'listing-groups-circle', () => {
			if (map) map.getCanvas().style.cursor = 'pointer'
		})

		map.on('mouseleave', 'listing-groups-circle', () => {
			if (map) map.getCanvas().style.cursor = ''
		})
	}

	// React to listing array changes; keep the visible groups and stand markers
	// up to date. Markers refresh as soon as the map exists; the grouped circles
	// need the layers (and thus the loaded style) first. Updating the source does
	// not move the camera, so this never triggers a viewport re-query.
	createEffect(() => {
		if (!map) return
		refreshStandMarkers()
		if (!layersReady) return
		updateGroupSource(groupByH3(props.listings, currentRes))
	})

	// A `center` arrives when the user clicks "Center" or "Jump to nearest"; fly
	// there at a fixed neighborhood zoom. Deferred so it never fights the initial
	// camera, which already reads `props.center` at setup. The resulting
	// `moveend` re-queries the viewport, which is the intended behavior.
	createEffect(
		on(
			() => props.center,
			(center) => {
				if (!center || !map) return
				map.flyTo({ center: [center.lng, center.lat], zoom: DEFAULT_MAP_ZOOM })
			},
			{ defer: true }
		)
	)

	return (
		<MapLibreGL
			class="listings-map"
			aria-label="Map of nearby produce listings"
			onReady={setupMap}
		/>
	)
}
