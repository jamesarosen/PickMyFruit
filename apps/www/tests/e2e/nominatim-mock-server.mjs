/**
 * Local stand-in for nominatim.openstreetmap.org. Geocoding runs server-side
 * (src/lib/geocoding.server.ts), so Playwright's network interception cannot
 * see those requests — instead the E2E web server points NOMINATIM_URL here
 * (see playwright.config.ts webServer entries).
 *
 * Test-only endpoints: GET /__stats returns the served request count;
 * POST /__reset zeroes it; GET /health is the readiness probe.
 */
import { createServer } from 'node:http'

const PORT = 5175

/** Downtown Napa — anchor point for deterministic test geocoding. */
const MOCK_ANCHOR = { lat: 38.2975, lng: -122.2869 }

/**
 * Spreads a query string into a deterministic lat/lng around Napa.
 * Keep in sync with hashToLatLng in helpers/nominatim-mock.ts.
 */
function hashToLatLng(query) {
	let hash = 0
	for (let i = 0; i < query.length; i++) {
		hash = (hash * 31 + query.charCodeAt(i)) | 0
	}
	return {
		lat: MOCK_ANCHOR.lat + ((hash & 0xff) - 128) * 0.0001,
		lng: MOCK_ANCHOR.lng + (((hash >> 8) & 0xff) - 128) * 0.0001,
	}
}

let searchCount = 0

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)

	if (url.pathname === '/health') {
		res.writeHead(200, { 'content-type': 'text/plain' })
		res.end('ok')
		return
	}

	if (url.pathname === '/__stats') {
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(JSON.stringify({ count: searchCount }))
		return
	}

	if (url.pathname === '/__reset' && req.method === 'POST') {
		searchCount = 0
		res.writeHead(204)
		res.end()
		return
	}

	if (url.pathname === '/search') {
		searchCount++
		const q = url.searchParams.get('q') ?? ''
		const { lat, lng } = hashToLatLng(q)
		res.writeHead(200, { 'content-type': 'application/json' })
		res.end(
			JSON.stringify([
				{
					lat: String(lat),
					lon: String(lng),
					display_name: q || 'Mock Location, Napa, CA, USA',
				},
			])
		)
		return
	}

	res.writeHead(404)
	res.end()
})

server.listen(PORT, '127.0.0.1', () => {
	console.log(`nominatim-mock-server listening on http://127.0.0.1:${PORT}`)
})
