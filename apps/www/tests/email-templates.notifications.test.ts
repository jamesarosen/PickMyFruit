import { describe, it, expect, test } from 'vitest'
import {
	buildNotificationEmailSubject,
	buildNotificationEmailHtml,
	buildNotificationEmailHeaders,
} from '../src/lib/email-templates'

const baseListing = {
	id: 42,
	type: 'Apples',
	quantity: '2 boxes',
	harvestWindow: 'Sept 1–15',
	city: 'Portland',
	state: 'OR',
}

const baseData = {
	baseUrl: 'https://example.com',
	subscriber: { name: 'Alice', email: 'alice@example.com' },
	subscriptionId: 7,
	userId: 'user-uuid-1234',
	throttlePeriod: 'daily' as const,
	listings: [baseListing],
	unsubscribeUrl:
		'https://example.com/api/notifications/7/unsubscribe?userId=user-uuid-1234&sig=fakesig',
}

describe(buildNotificationEmailSubject, () => {
	test.each([
		[1, '1 new listing near you'],
		[3, '3 new listings near you'],
	])('%i listing(s) + %s', (count, expected) => {
		const listings = Array.from({ length: count }, (_, i) => ({
			...baseListing,
			id: i + 1,
		}))
		expect(buildNotificationEmailSubject({ listings })).toBe(expected)
	})
})

describe(buildNotificationEmailHtml, () => {
	it('includes subscriber name', () => {
		const html = buildNotificationEmailHtml(baseData)
		expect(html).toContain('Hi Alice,')
	})

	it('includes listing type and city', () => {
		const html = buildNotificationEmailHtml(baseData)
		expect(html).toContain('Apples')
		expect(html).toContain('Portland')
	})

	it('includes a View listing link with the correct URL', () => {
		const html = buildNotificationEmailHtml(baseData)
		expect(html).toContain('href="https://example.com/listings/42"')
		expect(html).toContain('View listing')
	})

	it('includes harvest window when present', () => {
		const html = buildNotificationEmailHtml(baseData)
		expect(html).toContain('Harvest window:')
		expect(html).toContain('Sept 1–15')
	})

	it('omits harvest window when null', () => {
		const data = {
			...baseData,
			listings: [{ ...baseListing, harvestWindow: null }],
		}
		const html = buildNotificationEmailHtml(data)
		expect(html).not.toContain('Harvest window:')
	})

	it('includes a link to manage notifications', () => {
		const html = buildNotificationEmailHtml(baseData)
		expect(html).toContain('/notifications')
		expect(html).toContain('Manage your notification settings')
	})

	it('escapes HTML in listing fields', () => {
		const data = {
			...baseData,
			listings: [
				{
					...baseListing,
					type: '<script>alert(1)</script>',
					city: '<b>Evilcity</b>',
				},
			],
		}
		const html = buildNotificationEmailHtml(data)
		expect(html).not.toContain('<script>')
		expect(html).toContain('&lt;script&gt;')
		expect(html).not.toContain('<b>Evilcity</b>')
		expect(html).toContain('&lt;b&gt;Evilcity&lt;/b&gt;')
	})
})

describe(buildNotificationEmailHeaders, () => {
	const unsubscribeUrl =
		'https://example.com/api/notifications/7/unsubscribe?userId=user-uuid-1234&sig=fakesig'

	it('sets List-Unsubscribe to the URL in angle brackets', () => {
		const headers = buildNotificationEmailHeaders(unsubscribeUrl)
		expect(headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`)
	})

	it('sets List-Unsubscribe-Post for RFC 8058 one-click support', () => {
		const headers = buildNotificationEmailHeaders(unsubscribeUrl)
		expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
	})
})
