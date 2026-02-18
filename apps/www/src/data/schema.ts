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

export const listings = sqliteTable(
	'listings',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		type: text('type').notNull(), // e.g., 'apple', 'pear', 'plum', 'fig', 'lemon', 'orange', etc.
		variety: text('variety'), // e.g., 'Granny Smith', 'Honeycrisp', etc.
		status: text('status').notNull().default('available'), // 'available', 'unavailable', 'private'
		quantity: text('quantity'), // e.g., 'abundant', 'moderate', 'few'
		harvestWindow: text('harvest_window'), // e.g., 'September-October'

		// Location fields
		address: text('address').notNull(),
		city: text('city').notNull().default('Napa'),
		state: text('state').notNull().default('CA'),
		zip: text('zip'),
		lat: real('lat').notNull(),
		lng: real('lng').notNull(),
		h3Index: text('h3_index').notNull(), // H3 index at resolution 13 (~3m precision)

		// Owner — Better Auth user reference
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),

		// Metadata
		notes: text('notes'),
		accessInstructions: text('access_instructions'), // e.g., 'Ring doorbell', 'Gate code 1234'
		deletedAt: integer('deleted_at', { mode: 'timestamp' }), // soft delete
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(table) => [index('listings_user_id_idx').on(table.userId)]
)

export type Listing = typeof listings.$inferSelect
export type NewListing = typeof listings.$inferInsert

/** Subset of listing fields used for address pre-fill. */
export type AddressFields = Pick<Listing, 'address' | 'city' | 'state' | 'zip'>

// ============================================================================
// Inquiries Table
// ============================================================================

export const inquiries = sqliteTable(
	'inquiries',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		listingId: integer('listing_id')
			.notNull()
			.references(() => listings.id),
		gleanerId: text('gleaner_id')
			.notNull()
			.references(() => user.id),
		note: text('note'), // max 500 chars, validated at API layer
		emailSentAt: integer('email_sent_at', { mode: 'timestamp' }),
	},
	(table) => [
		index('inquiry_listing_id_idx').on(table.listingId),
		index('inquiry_gleaner_id_idx').on(table.gleanerId),
	]
)

export type Inquiry = typeof inquiries.$inferSelect
export type NewInquiry = typeof inquiries.$inferInsert
