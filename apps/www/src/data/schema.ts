import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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

	// Owner reference
	ownerId: integer('owner_id')
		.notNull()
		.references(() => owners.id),

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
