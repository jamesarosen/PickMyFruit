import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const wwwRoot = resolve(__dirname, '../..')
const testDbPath = resolve(wwwRoot, 'test.db')

export default async function globalSetup() {
	// Initialize test database schema
	execSync('pnpm db:push', {
		cwd: wwwRoot,
		env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
		stdio: 'inherit',
	})
	// Test users are now created per-test in beforeEach hooks
}
