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
		.map((row) => {
			// TODO: consider a real CSV parser as a build-time dependency. For now,
			// re-joining description parts handles descriptions with commas
			const [slug, commonName, category] = row.split(',')
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
