import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

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

	// Owner info
	ownerName: text('owner_name').notNull(),
	ownerEmail: text('owner_email'),
	ownerPhone: text('owner_phone'),

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
