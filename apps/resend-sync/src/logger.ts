import pino from "pino";

const isDev = process.env.NODE_ENV === "development";

/**
 * Structured logger for the resend-sync worker. Mirrors apps/www/logger.server
 * conventions (pino, pino-pretty in dev, JSON in prod, redacted PII fields).
 *
 * Structured fields come **first**: `logger.info({ userId, ... }, 'message')`.
 */
export const logger = pino({
	name: "resend-sync",
	level: isDev ? "debug" : "info",
	redact: {
		paths: [
			"**.token",
			"**.accessToken",
			"**.refreshToken",
			"**.password",
			"**.secret",
			"**.key",
			"**.apiKey",
			"**.email",
			"**.name",
			"**.phone",
			"req.headers.authorization",
			'req.headers["x-internal-auth"]',
		],
	},
	transport: isDev
		? { target: "pino-pretty", options: { colorize: true } }
		: undefined,
});
