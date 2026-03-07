import rawCsv from './produce-types.csv?raw'

/** A single shareable produce type from the catalog. */
export interface ProduceType {
	slug: string
	commonName: string
	category: string
}

function parseCsv(raw: string): ProduceType[] {
	const [_header, ...rows] = raw.trim().split('\n')
	return rows
		.filter((r) => r.trim())
		.map((row) => {
			// TODO: consider a real CSV parser as a build-time dependency. For now,
			// we drop description, which is the only column that would have
			// content that needs a true CSV parser.
			const [slug, commonName, category] = row.trimEnd().split(',')
			return {
				slug,
				commonName,
				category,
			}
		})
		.toSorted((a, b) => a.commonName.localeCompare(b.commonName))
}

/** All produce types sorted alphabetically by common name. Category order reflects CSV file order. */
export const produceTypes: readonly ProduceType[] = parseCsv(rawCsv)

/** Valid slug set for O(1) validation. */
export const produceTypeSlugs: ReadonlySet<string> = new Set(
	produceTypes.map((t) => t.slug)
)
