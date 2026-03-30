import type { Config } from 'drizzle-kit'
import path from 'node:path'

const dbPath = path.resolve(__dirname, 'data', 'development.db')

export default {
	schema: './src/data/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: process.env.DATABASE_URL || `file:${dbPath}`,
	},
} satisfies Config
