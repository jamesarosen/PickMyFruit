import {
	sqliteTable,
	text,
	integer,
	real,
	index,
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ============================================================================
// Better Auth Tables
// ============================================================================

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' })
		.notNull()
		.default(false),
	image: text('image'),
	phone: text('phone'), // Custom field for Pick My Fruit
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
})

export type User = typeof user.$inferSelect
export type NewUser = typeof user.$inferInsert

export const session = sqliteTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		token: text('token').notNull().unique(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index('session_user_id_idx').on(table.userId)]
)

export const account = sqliteTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: integer('access_token_expires_at', {
			mode: 'timestamp_ms',
		}),
		refreshTokenExpiresAt: integer('refresh_token_expires_at', {
			mode: 'timestamp_ms',
		}),
		scope: text('scope'),
		password: text('password'),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index('account_user_id_idx').on(table.userId)]
)

export const verification = sqliteTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index('verification_identifier_idx').on(table.identifier)]
)

// ============================================================================
// Application Tables
// ============================================================================

export const owners = sqliteTable('owners', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	phone: text('phone'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
})

export type Owner = typeof owners.$inferSelect
export type NewOwner = typeof owners.$inferInsert

export const plants = sqliteTable('plants', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	type: text('type').notNull(), // e.g., 'apple', 'pear', 'plum', 'fig', 'lemon', 'orange', etc.
	variety: text('variety'), // e.g., 'Granny Smith', 'Honeycrisp', etc.
	status: text('status').notNull().default('available'), // 'available', 'claimed', 'harvested'
	quantity: text('quantity'), // e.g., 'abundant', 'moderate', 'few'
	harvestWindow: text('harvest_window'), // e.g., 'September-October'

	// Location fields
	address: text('address').notNull(),
	city: text('city').notNull().default('Napa'),
	state: text('state').notNull().default('CA'),
	zip: text('zip'),
	lat: real('lat').notNull(),
	lng: real('lng').notNull(),
	h3Index: text('h3_index').notNull(), // H3 index at resolution 9

	// Owner reference (legacy - will be migrated to userId in future PR)
	ownerId: integer('owner_id')
		.notNull()
		.references(() => owners.id),

	// User reference (Better Auth - for authenticated users)
	userId: text('user_id').references(() => user.id),

	// Metadata
	notes: text('notes'),
	accessInstructions: text('access_instructions'), // e.g., 'Ring doorbell', 'Gate code 1234'
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
})

export type Plant = typeof plants.$inferSelect
export type NewPlant = typeof plants.$inferInsert
