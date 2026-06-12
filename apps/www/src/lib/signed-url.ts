/**
 * Signed URLs expire after 7 days. Lives outside `hmac.server.ts` so modules
 * that only need the window (e.g. the used-nonce purge) don't pull in the
 * eager env validation that the HMAC secret requires.
 */
export const SIGNATURE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
