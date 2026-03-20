import { createEffect, on } from 'solid-js'
import {
	gridDisk,
	cellToBoundary,
	cellsToMultiPolygon,
	isValidCell,
	latLngToCell,
	getResolution,
} from 'h3-js'
import { Sentry } from '@/lib/sentry'
import MapLibreGL, { type MapLibreGLReadyArgs } from '@/components/MapLibreGL'

// MapLibre paint properties require literal color strings, not CSS variables.
const COLOR_FILL = '#10b981' // --color-fresh-green
const COLOR_STROKE = '#059669'

/**
 * Merges a set of H3 cells into a single GeoJSON MultiPolygon feature.
 * Uses cellsToMultiPolygon so only the outer boundary is drawn — no
 * internal grid lines between individual cells.
 */
function cellsToGeoJSON(cells: string[]): GeoJSON.Feature {
	// formatAsGeoJson=true returns [lng, lat] order required by GeoJSON
	const coordinates = cellsToMultiPolygon(cells, true)
	return {
		type: 'Feature',
		geometry: { type: 'MultiPolygon', coordinates },
		properties: {},
	}
}

/**
 * Computes the lng/lat bounding box of a set of H3 cells.
 * Returns [[minLng, minLat], [maxLng, maxLat]] for use with fitBounds.
 */
function cellsBounds(cells: string[]): [[number, number], [number, number]] {
	let minLng = Infinity,
		maxLng = -Infinity,
		minLat = Infinity,
		maxLat = -Infinity
	for (const cell of cells) {
		for (const [lat, lng] of cellToBoundary(cell)) {
			if (lng < minLng) minLng = lng
			if (lng > maxLng) maxLng = lng
			if (lat < minLat) minLat = lat
			if (lat > maxLat) maxLat = lat
		}
	}
	return [
		[minLng, minLat],
		[maxLng, maxLat],
	]
}

interface Props {
	/** H3 cell index for the center of the coverage area, or null when unset. */
	centerH3: string | null
	/** Number of rings to expand beyond the center cell (0–6). */
	ringSize: number
	/** Called when the user clicks the map to reposition the coverage center. */
	onRecenter?: (centerH3: string) => void
}

/** Map preview showing the H3 cell disk that a subscription will cover. */
export default function SubscriptionCoverageMap(props: Props) {
	let map: import('maplibre-gl').Map | undefined
	let layersReady = false

	function updateCoverage() {
		if (!map || !layersReady) return
		const source = map.getSource('coverage') as
			| import('maplibre-gl').GeoJSONSource
			| undefined
		if (!source) return

		const h3 = props.centerH3
		if (!h3 || !isValidCell(h3)) {
			source.setData({ type: 'FeatureCollection', features: [] })
			return
		}

		try {
			const cells = gridDisk(h3, props.ringSize)
			source.setData(cellsToGeoJSON(cells))
			// Fit the map so the covered disk fills the viewport. fitBounds
			// guarantees the area occupies the viewport minus padding, which
			// comfortably exceeds the 25%-of-map-area floor at any ring size.
			map.fitBounds(cellsBounds(cells), {
				padding: 40,
				duration: 400,
				maxZoom: 14,
			})
		} catch (err) {
			Sentry.captureException(err)
			source.setData({ type: 'FeatureCollection', features: [] })
		}
	}

	createEffect(
		on([() => props.centerH3, () => props.ringSize] as const, updateCoverage)
	)

	function setupMap({ container, maplibregl }: MapLibreGLReadyArgs) {
		const h3 = props.centerH3
		// Start somewhere reasonable; updateCoverage() will fitBounds once loaded.
		const initialCenter: [number, number] =
			h3 && isValidCell(h3)
				? (() => {
						const cells = gridDisk(h3, props.ringSize)
						const [[minLng, minLat], [maxLng, maxLat]] = cellsBounds(cells)
						return [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as [number, number]
					})()
				: [-122.4, 37.8] // Bay Area fallback

		map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			center: initialCenter,
			zoom: 8,
			attributionControl: false,
		})

		map.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			'bottom-right'
		)

		// Crosshair cursor signals the map is clickable to reposition coverage.
		map.getCanvas().style.cursor = 'crosshair'

		map.on('click', (e) => {
			if (!props.onRecenter) return
			const resolution =
				props.centerH3 && isValidCell(props.centerH3)
					? getResolution(props.centerH3)
					: 7
			props.onRecenter(latLngToCell(e.lngLat.lat, e.lngLat.lng, resolution))
		})

		map.on('load', () => {
			if (!map) return

			map.addSource('coverage', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			})

			map.addLayer({
				id: 'coverage-fill',
				type: 'fill',
				source: 'coverage',
				paint: { 'fill-color': COLOR_FILL, 'fill-opacity': 0.2 },
			})

			map.addLayer({
				id: 'coverage-outline',
				type: 'line',
				source: 'coverage',
				paint: { 'line-color': COLOR_STROKE, 'line-width': 1.5 },
			})

			layersReady = true
			updateCoverage()
		})

		return () => {
			map?.remove()
			map = undefined
		}
	}

	return (
		<MapLibreGL
			class="subscription-coverage-map"
			aria-label="Map showing notification coverage area"
			onReady={setupMap}
		/>
	)
}
