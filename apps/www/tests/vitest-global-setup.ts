import {
	createGoldenDatabase,
	sweepOrphanedTestDbs,
} from './helpers/test-db-setup'

export default function globalSetup() {
	sweepOrphanedTestDbs()
	console.log('[test-db] Creating golden database...')
	createGoldenDatabase()
	console.log('[test-db] Golden database ready.')
}

export async function teardown() {
	sweepOrphanedTestDbs()
}
