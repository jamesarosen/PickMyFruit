/**
 * Returns user.name if set, otherwise the local-part of their email, or
 * the given fallback if the email has no local-part.
 */
export function displayName(
	user: { name: string; email: string },
	fallback = 'Friend'
): string {
	return user.name.trim() || user.email.split('@')[0] || fallback
}
