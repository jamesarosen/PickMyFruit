import type { Config } from 'drizzle-kit'

export default {
	schema: './src/data/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: process.env.DATABASE_URL || 'file:local.db',
	},
} satisfies Config
