import pino from 'pino'

// Only enable pino-pretty in local development — not in test or production.
// pino-pretty is a devDependency and is not available in the production image.
const isDev = process.env.NODE_ENV === 'development'

/**
 * Paths redacted to prevent credentials and PII from reaching log sinks. Uses
 * deep-wildcard syntax (`**`) to match at any nesting depth. Add freely; never
 * remove without a privacy review.
 */
const REDACTED_PATHS = [
	// Auth tokens and credentials
	'**.token',
	'**.accessToken',
	'**.refreshToken',
	'**.password',
	'**.secret',
	'**.key',
	'**.apiKey',

	// PII
	'**.address',
	'**.email',
	'**.h3_index',
	'**.lat',
	'**.lng',
	'**.name',
	'**.phone',

	// URLs — query params stripped rather than fully redacted (see censor below)
	'**.url',

	// HTTP layer
	'req.headers.authorization',
	'req.headers.cookie',
	'res.headers["set-cookie"]',
]

const URL_KEY = /(^url$)|(U[rR][lL]$)/
const EMAIL_KEY = /(^email$)|(E[mM][aA][iI][lL]$)/

/**
 * Production censor: strips query params from URLs (keeps origin+path
 * readable), masks the local part of email addresses (keeps domain for
 * debugging), and replaces everything else with `'[Redacted]'`.
 */
function prodCensor(value: unknown, path: string[]): unknown {
	const key = path[path.length - 1]
	if (URL_KEY.test(key) && (typeof value === 'string' || value instanceof URL)) {
		try {
			const u = new URL(value)
			u.search = ''
			return u.toString()
		} catch {
			return '[Redacted]'
		}
	}
	if (EMAIL_KEY.test(key) && typeof value === 'string') {
		const at = value.indexOf('@')
		return at > 0 ? `xxx${value.slice(at)}` : '[Redacted]'
	}
	return '[Redacted]'
}

/**
 * Development censor: wraps values with `[[…]]` markers so it's obvious which
 * fields would be redacted in production without hiding the values themselves.
 */
function devCensor(value: unknown): unknown {
	return `[[${String(value)}]]`
}

/**
 * Server-side structured logger. Uses pino-pretty in development; JSON in
 * production. Sensitive fields are redacted centrally so call sites never need
 * to scrub values manually. In development, matched fields are wrapped with
 * `[[…]]` markers so it's obvious what would be redacted in production. In
 * production, URL query params are stripped, email local-parts are masked
 * (`xxx@domain`), and everything else is replaced with `[Redacted]`.
 *
 * When logging structured fields alongside a message, the object must come
 * first — `logger.info('msg', { field })` silently drops the object.
 *
 * @example
 * logger.info('App started')
 * logger.info({ userId, action: 'login' }, 'User authenticated')
 *
 * @see https://getpino.io/#/docs/redaction
 */
export const logger = pino({
	name: 'pickmyfruit',
	level: isDev ? 'debug' : 'info',
	// dev:  wrap matched values with [[…]] so it's clear what would be redacted in prod.
	// prod: strip query params from URLs, mask email local-parts, redact everything else.
	redact: { paths: REDACTED_PATHS, censor: isDev ? devCensor : prodCensor },
	transport: isDev
		? { target: 'pino-pretty', options: { colorize: true } }
		: undefined,
})
