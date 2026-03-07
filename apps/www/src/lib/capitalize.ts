/** Capitalizes the first character of a string. */
export function capitalize(s: string): string {
	return s.charAt(0).toLocaleUpperCase() + s.slice(1)
}
