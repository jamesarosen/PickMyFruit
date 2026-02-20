import { onMount, onCleanup, createEffect, on } from 'solid-js'
import type { PublicListing } from '@/data/queries'
import { cellToLatLng, cellToBoundary, cellToParent } from 'h3-js'
import { H3_RESOLUTIONS, zoomToH3Resolution } from '@/lib/h3-resolutions'
import { Sentry } from '@/lib/sentry'
import '@/components/ListingsMap.css'

/** A group of listings sharing the same approximate H3 cell. */
export interface ListingGroup {
	h3Index: string
	center: [lng: number, lat: number]
	listings: PublicListing[]
}

// MapLibre paint properties require literal color strings, not CSS variables.
const COLOR_SELECTED = '#ff6b5a' // --color-sunset-coral
const COLOR_DEFAULT = '#10b981' // --color-fresh-green
const COLOR_LABEL = '#ffffff'
const COLOR_REGION_FILL = '#10b981' // --color-fresh-green
const COLOR_REGION_STROKE = '#10b981'

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
	/** Called when a group marker is clicked. Null clears the filter. */
	onGroupSelect?: (h3Index: string | null) => void
	/** Currently selected H3 index, for highlighting. */
	selectedH3?: string | null
}

/** Map showing nearby listings grouped by H3 cell. */
export default function ListingsMap(props: Props) {
	let containerRef!: HTMLDivElement
	let map: import('maplibre-gl').Map | undefined
	let mounted = true
	let layersReady = false

	onMount(async () => {
		try {
			const maplibregl = await import('maplibre-gl')
			await import('maplibre-gl/dist/maplibre-gl.css')
			if (!mounted) return

			const groups = groupByH3(props.listings)
			const bounds = new maplibregl.LngLatBounds()
			for (const group of groups) {
				bounds.extend(group.center)
			}

			map = new maplibregl.Map({
				container: containerRef,
				style: 'https://tiles.openfreemap.org/styles/liberty',
				bounds: groups.length > 0 ? bounds : undefined,
				center: groups.length === 0 ? [-122.2893688, 38.2966234] : undefined,
				zoom: groups.length === 0 ? 13 : undefined,
				fitBoundsOptions: { padding: 60, maxZoom: 14 },
				attributionControl: false,
			})

			map.addControl(
				new maplibregl.AttributionControl({ compact: true }),
				'bottom-right'
			)
			map.addControl(new maplibregl.NavigationControl({ showCompass: false }))

			let currentRes: number = H3_RESOLUTIONS.HOME_GROUPING

			map.on('load', () => {
				addGroupLayers(groups)
				addRegionLayers()
				layersReady = true

				// Adjust resolution to match the map's initial zoom
				if (!map) return
				const initialRes = zoomToH3Resolution(map.getZoom())
				if (initialRes !== currentRes) {
					currentRes = initialRes
					updateGroupSource(groupByH3(props.listings, currentRes))
				}

				if (props.selectedH3) {
					updateRegion(props.selectedH3)
					updateHighlight()
				}
			})

			map.on('zoomend', () => {
				if (!mounted || !layersReady || !map) return
				const newRes = zoomToH3Resolution(map.getZoom())
				if (newRes === currentRes) return
				currentRes = newRes
				updateGroupSource(groupByH3(props.listings, currentRes))
				// Clear selection — the old cell may not exist at the new resolution
				props.onGroupSelect?.(null)
			})
		} catch (err) {
			Sentry.captureException(err)
		}
	})

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
				'circle-color': [
					'case',
					['==', ['get', 'h3Index'], ''],
					COLOR_SELECTED,
					COLOR_DEFAULT,
				],
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
				'text-font': ['Open Sans Bold'],
				'text-allow-overlap': true,
			},
			paint: {
				'text-color': COLOR_LABEL,
			},
		})

		map.on('click', 'listing-groups-circle', (e) => {
			const feature = e.features?.[0]
			if (!feature) return
			const clickedH3 = feature.properties?.h3Index
			if (props.selectedH3 === clickedH3) {
				props.onGroupSelect?.(null)
			} else {
				props.onGroupSelect?.(clickedH3)
			}
		})

		map.on('mouseenter', 'listing-groups-circle', () => {
			if (map) map.getCanvas().style.cursor = 'pointer'
		})

		map.on('mouseleave', 'listing-groups-circle', () => {
			if (map) map.getCanvas().style.cursor = ''
		})
	}

	/** Adds the region outline source and layers (initially empty). */
	function addRegionLayers() {
		if (!map) return

		const emptyPolygon: GeoJSON.FeatureCollection = {
			type: 'FeatureCollection',
			features: [],
		}

		map.addSource('selected-region', { type: 'geojson', data: emptyPolygon })

		// Region fill — rendered below the pip layers
		map.addLayer(
			{
				id: 'selected-region-fill',
				type: 'fill',
				source: 'selected-region',
				paint: {
					'fill-color': COLOR_REGION_FILL,
					'fill-opacity': 0.15,
				},
			},
			'listing-groups-circle' // insert before circle layer
		)

		map.addLayer(
			{
				id: 'selected-region-outline',
				type: 'line',
				source: 'selected-region',
				paint: {
					'line-color': COLOR_REGION_STROKE,
					'line-width': 2,
				},
			},
			'listing-groups-circle'
		)
	}

	/** Updates the region outline to show the boundary of the given H3 cell. */
	function updateRegion(h3Index: string | null | undefined) {
		if (!map || !layersReady) return

		const source = map.getSource('selected-region') as
			| import('maplibre-gl').GeoJSONSource
			| undefined
		if (!source) return

		if (!h3Index) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		try {
			const ring = h3ToPolygonCoordinates(h3Index)
			source.setData({
				type: 'Feature',
				geometry: { type: 'Polygon', coordinates: [ring] },
				properties: {},
			})
		} catch (err) {
			Sentry.captureException(err)
			source.setData({ type: 'FeatureCollection', features: [] })
		}
	}

	function updateHighlight() {
		if (!map?.getLayer('listing-groups-circle')) return

		map.setPaintProperty('listing-groups-circle', 'circle-color', [
			'case',
			['==', ['get', 'h3Index'], props.selectedH3 ?? ''],
			COLOR_SELECTED,
			COLOR_DEFAULT,
		])
	}

	createEffect(
		on(
			() => props.selectedH3,
			() => {
				updateHighlight()
				updateRegion(props.selectedH3)
			}
		)
	)

	onCleanup(() => {
		mounted = false
		map?.remove()
		map = undefined
	})

	return (
		<div
			ref={containerRef}
			class="listings-map"
			role="application"
			aria-label="Map of nearby fruit listings"
		/>
	)
}
