import { clientEnv } from '@/lib/env.client'

/** Icon and optional media CDN preconnect links for the document head. */
export function rootHeadLinks() {
	return [
		{
			rel: 'icon' as const,
			href: '/favicon.svg',
			type: 'image/svg+xml' as const,
		},
		...(clientEnv.mediaOrigin
			? [
					{
						rel: 'preconnect' as const,
						href: clientEnv.mediaOrigin,
						crossOrigin: 'anonymous' as const,
					},
				]
			: []),
	]
}
