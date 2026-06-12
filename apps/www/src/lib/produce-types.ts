import rawCsv from './produce-types.csv?raw'

/** A single shareable produce type from the catalog. */
export interface ProduceType {
	slug: string
	category: string
	/** Title-case singular — for headings and labels. e.g. "Brussels Sprouts" */
	nameSingularTitleCase: string
	/** Title-case plural — for headings and labels. e.g. "Brussels Sprouts" */
	namePluralTitleCase: string
	/** Sentence-case singular — for use in prose. e.g. "brussels sprouts" */
	nameSingularSentenceCase: string
	/** Sentence-case plural — for use in prose. e.g. "brussels sprouts" */
	namePluralSentenceCase: string
}

function parseCsv(raw: string): ProduceType[] {
	const [_header, ...rows] = raw.trim().split('\n')
	return rows
		.filter((r) => r.trim())
		.map((row) => {
			// TODO: consider a real CSV parser as a build-time dependency. For now,
			// description is the only column that could contain commas, and it is
			// last, so the first six fields are safe to destructure directly.
			const [
				slug,
				category,
				nameSingularTitleCase,
				namePluralTitleCase,
				nameSingularSentenceCase,
				namePluralSentenceCase,
			] = row.trimEnd().split(',')
			return {
				slug,
				category,
				nameSingularTitleCase,
				namePluralTitleCase,
				nameSingularSentenceCase,
				namePluralSentenceCase,
			}
		})
		.sort((a, b) =>
			a.nameSingularTitleCase.localeCompare(b.nameSingularTitleCase)
		)
}

/** All produce types sorted alphabetically by common name. Category order reflects CSV file order. */
export const produceTypes: readonly ProduceType[] = parseCsv(rawCsv)

/** Valid slug set for O(1) validation. */
export const produceTypeSlugs: ReadonlySet<string> = new Set(
	produceTypes.map((t) => t.slug)
)

const produceTypesBySlug: ReadonlyMap<string, ProduceType> = new Map(
	produceTypes.map((t) => [t.slug, t])
)

/** Looks up a produce type by slug, or `undefined` if the slug is unknown. */
export function produceTypeBySlug(slug: string): ProduceType | undefined {
	return produceTypesBySlug.get(slug)
}

/** The slug for the take-it-or-leave-it produce-stand listing type. */
export const PRODUCE_STAND_SLUG = 'produce-stand'

/**
 * Sentence-case plural display name for a produce slug (e.g. `apple` →
 * "apples", `produce-stand` → "produce"). Falls back to the raw slug for
 * unknown values so callers never render `undefined`.
 */
export function pluralProduceName(slug: string): string {
	return produceTypeBySlug(slug)?.namePluralSentenceCase ?? slug
}

/**
 * The predicate that follows a visitor's name in inquiry copy — e.g. "wants
 * your apples". A produce stand is take-it-or-leave-it with no single produce
 * noun, so it reads "wants to visit your produce stand".
 */
export function inquiryDesire(slug: string): string {
	const type = produceTypeBySlug(slug)
	return slug === PRODUCE_STAND_SLUG
		? `wants to visit your ${type?.nameSingularSentenceCase ?? slug}`
		: `wants your ${type?.namePluralSentenceCase ?? slug}`
}
