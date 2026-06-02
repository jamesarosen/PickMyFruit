import { Show } from 'solid-js'
import { cellToLatLng, cellToBoundary, cellToParent } from 'h3-js'
import MapPin from 'lucide-solid/icons/map-pin'
import Hexagon from 'lucide-solid/icons/hexagon'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import MapLibreGL, {
	MapLibreGLReadyArgs,
	reportMapLoadedOnce,
} from '@/components/MapLibreGL'
import '@/components/ListingMap.css'

interface OwnerProps {
	mode: 'owner'
	lat: number
	lng: number
	h3Index: string
	/**
	 * Resolution to coarsen `h3Index` to for the "what others see" hexagon.
	 * Defaults to {@link H3_RESOLUTIONS.PUBLIC_DETAIL}; pass a finer (larger)
	 * value when the listing's address-release policy widens visibility.
	 */
	publicHexResolution?: number
}

interface PublicProps {
	mode: 'public'
	approximateH3Index: string
}

interface VerifiedProps {
	mode: 'verified'
	lat: number
	lng: number
}

type Props = OwnerProps | PublicProps | VerifiedProps

// MapLibre paint properties require literal color strings, not CSS variables.
const COLOR_MARKER = '#10b981' // --color-fresh-green
const COLOR_AREA = '#8b5a8e' // --color-fig

/** Builds a closed GeoJSON polygon ring from an H3 cell index. */
function h3ToPolygonRing(h3Index: string): number[][] {
	const ring = cellToBoundary(h3Index).map(([lat, lng]) => [lng, lat])
	ring.push(ring[0])
	return ring
}

/** Map showing a single listing's location. */
export default function ListingMap(props: Props) {
	let map: import('maplibre-gl').Map | undefined

	function setupMap({ container, maplibregl, onMapLoad }: MapLibreGLReadyArgs) {
		if (props.mode === 'owner') {
			initOwnerMap(
				maplibregl,
				container,
				props.lat,
				props.lng,
				props.h3Index,
				props.publicHexResolution ?? H3_RESOLUTIONS.PUBLIC_DETAIL,
				onMapLoad
			)
		} else if (props.mode === 'verified') {
			initVerifiedMap(maplibregl, container, props.lat, props.lng, onMapLoad)
		} else {
			initPublicMap(maplibregl, container, props.approximateH3Index, onMapLoad)
		}
		return () => {
			map?.remove()
			map = undefined
		}
	}

	function initOwnerMap(
		maplibregl: typeof import('maplibre-gl'),
		container: HTMLDivElement,
		lat: number,
		lng: number,
		h3Index: string,
		publicHexResolution: number,
		onMapLoad: () => void
	) {
		const publicH3 = cellToParent(h3Index, publicHexResolution)

		map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			center: [lng, lat],
			zoom: 13,
			attributionControl: false,
		})

		map.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			'bottom-right'
		)
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }))

		reportMapLoadedOnce(map, onMapLoad, () => {
			if (!map) return

			const ring = h3ToPolygonRing(publicH3)
			map.addSource('public-area', {
				type: 'geojson',
				data: {
					type: 'Feature',
					geometry: { type: 'Polygon', coordinates: [ring] },
					properties: {},
				},
			})

			map.addLayer({
				id: 'public-area-fill',
				type: 'fill',
				source: 'public-area',
				paint: {
					'fill-color': COLOR_AREA,
					'fill-opacity': 0.15,
				},
			})

			map.addLayer({
				id: 'public-area-outline',
				type: 'line',
				source: 'public-area',
				paint: {
					'line-color': COLOR_AREA,
					'line-width': 2,
				},
			})
		})

		new maplibregl.Marker({ color: COLOR_MARKER })
			.setLngLat([lng, lat])
			.addTo(map)
	}

	function initVerifiedMap(
		maplibregl: typeof import('maplibre-gl'),
		container: HTMLDivElement,
		lat: number,
		lng: number,
		onMapLoad: () => void
	) {
		map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			center: [lng, lat],
			zoom: 16,
			attributionControl: false,
		})

		map.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			'bottom-right'
		)
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }))

		reportMapLoadedOnce(map, onMapLoad, () => {
			if (!map) return
		})

		new maplibregl.Marker({ color: COLOR_MARKER })
			.setLngLat([lng, lat])
			.addTo(map)
	}

	function initPublicMap(
		maplibregl: typeof import('maplibre-gl'),
		container: HTMLDivElement,
		h3Index: string,
		onMapLoad: () => void
	) {
		const [lat, lng] = cellToLatLng(h3Index)
		const boundary = h3ToPolygonRing(h3Index)

		map = new maplibregl.Map({
			container,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			center: [lng, lat],
			zoom: 14,
			attributionControl: false,
		})

		map.addControl(
			new maplibregl.AttributionControl({ compact: true }),
			'bottom-right'
		)
		map.addControl(new maplibregl.NavigationControl({ showCompass: false }))

		reportMapLoadedOnce(map, onMapLoad, () => {
			if (!map) return

			map.addSource('listing-area', {
				type: 'geojson',
				data: {
					type: 'Feature',
					geometry: { type: 'Polygon', coordinates: [boundary] },
					properties: {},
				},
			})

			map.addLayer({
				id: 'listing-area-fill',
				type: 'fill',
				source: 'listing-area',
				paint: {
					'fill-color': COLOR_AREA,
					'fill-opacity': 0.2,
				},
			})

			map.addLayer({
				id: 'listing-area-outline',
				type: 'line',
				source: 'listing-area',
				paint: {
					'line-color': COLOR_AREA,
					'line-width': 2,
				},
			})
		})
	}

	return (
		<div class="listing-map-container">
			<MapLibreGL
				class="listing-map"
				role="img"
				aria-label={
					props.mode === 'owner'
						? 'Map showing exact listing location and public area'
						: props.mode === 'verified'
							? 'Map showing exact listing location'
							: 'Map showing approximate listing area'
				}
				onReady={setupMap}
			/>
			<Show when={props.mode === 'owner'}>
				<div class="listing-map-legend">
					<span class="legend-item">
						<MapPin size="1.25em" color={COLOR_MARKER} />
						Exact location
					</span>
					<span class="legend-item">
						<Hexagon size="1.25em" color={COLOR_AREA} />
						What others see
					</span>
				</div>
			</Show>
		</div>
	)
}
