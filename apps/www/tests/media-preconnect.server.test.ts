import { describe, it, expect } from 'vitest'
import {
	responseLooksLikeHtmlDocument,
	withMediaPreconnectLink,
} from '../src/middleware/media-preconnect'

describe('responseLooksLikeHtmlDocument', () => {
	it('returns true for text/html', () => {
		const r = new Response('', {
			headers: { 'content-type': 'text/html; charset=utf-8' },
		})
		expect(responseLooksLikeHtmlDocument(r)).toBe(true)
	})

	it('returns false for application/json', () => {
		const r = new Response('{}', {
			headers: { 'content-type': 'application/json' },
		})
		expect(responseLooksLikeHtmlDocument(r)).toBe(false)
	})

	it('returns false for application/xhtml+xml', () => {
		const r = new Response('', {
			headers: { 'content-type': 'application/xhtml+xml' },
		})
		expect(responseLooksLikeHtmlDocument(r)).toBe(false)
	})
})

describe('withMediaPreconnectLink', () => {
	it('sets Link preconnect to the given origin', () => {
		const inner = new Response('<html></html>', {
			status: 200,
			headers: { 'content-type': 'text/html' },
		})
		const out = withMediaPreconnectLink(inner, 'https://media.example.com')
		expect(out.headers.get('Link')).toBe(
			'<https://media.example.com>; rel=preconnect; crossorigin'
		)
	})

	it('appends when Link is already present', () => {
		const inner = new Response('', {
			headers: {
				'content-type': 'text/html',
				Link: '</style.css>; rel=preload; as=style',
			},
		})
		const out = withMediaPreconnectLink(inner, 'https://cdn.example.com')
		expect(out.headers.get('Link')).toBe(
			'</style.css>; rel=preload; as=style, <https://cdn.example.com>; rel=preconnect; crossorigin'
		)
	})
})
