import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'
import { db } from './db'
import { listings, user, type NewListing, type NewUser } from './schema'
import { ListingStatus } from '@/lib/validation'

// Napa Valley approximate bounds
const NAPA_BOUNDS = {
	latMin: 38.25,
	latMax: 38.55,
	lngMin: -122.5,
	lngMax: -122.2,
}

const FRUIT_TYPES = [
	{
		type: 'apple',
		varieties: ['Granny Smith', 'Honeycrisp', 'Fuji', 'Gala', 'Red Delicious'],
	},
	{ type: 'pear', varieties: ['Bartlett', 'Bosc', 'Anjou', 'Asian', 'Comice'] },
	{
		type: 'plum',
		varieties: ['Santa Rosa', 'Black Beauty', 'Satsuma', 'Italian Prune'],
	},
	{
		type: 'fig',
		varieties: ['Black Mission', 'Brown Turkey', 'Kadota', 'Calimyrna'],
	},
	{ type: 'lemon', varieties: ['Eureka', 'Lisbon', 'Meyer', 'Variegated Pink'] },
	{
		type: 'orange',
		varieties: ['Navel', 'Valencia', 'Blood Orange', 'Cara Cara'],
	},
	{
		type: 'peach',
		varieties: ['Elberta', 'Redhaven', 'Georgia Belle', 'Donut'],
	},
	{ type: 'apricot', varieties: ['Blenheim', 'Tilton', 'Moorpark', 'Royal'] },
	{
		type: 'persimmon',
		varieties: ['Fuyu', 'Hachiya', 'Chocolate', 'Tanenashi'],
	},
	{
		type: 'pomegranate',
		varieties: ['Wonderful', 'Angel Red', 'Eversweet', 'Kashmir Blend'],
	},
]

const QUANTITIES = ['abundant', 'moderate', 'few']
const STATUSES = [
	ListingStatus.available,
	ListingStatus.available,
	ListingStatus.available,
	ListingStatus.unavailable,
] // More weight to available

function generateUser(): NewUser {
	return {
		id: faker.string.uuid(),
		name: faker.person.fullName(),
		email: faker.internet.email(),
		emailVerified: true,
		phone: faker.helpers.maybe(() => faker.phone.number({ style: 'national' }), {
			probability: 0.7,
		}),
		createdAt: faker.date.past({ years: 1 }),
		updatedAt: faker.date.recent({ days: 30 }),
	}
}

function generateListing(userId: string): NewListing {
	const fruitType = faker.helpers.arrayElement(FRUIT_TYPES)
	const lat = faker.number.float({
		min: NAPA_BOUNDS.latMin,
		max: NAPA_BOUNDS.latMax,
		fractionDigits: 6,
	})
	const lng = faker.number.float({
		min: NAPA_BOUNDS.lngMin,
		max: NAPA_BOUNDS.lngMax,
		fractionDigits: 6,
	})
	const h3Index = latLngToCell(lat, lng, 13)

	// Generate harvest window based on fruit type
	const harvestMonths = {
		apple: ['September', 'October', 'November'],
		pear: ['August', 'September', 'October'],
		plum: ['July', 'August', 'September'],
		fig: ['June', 'July', 'August', 'September'],
		lemon: ['Year-round'],
		orange: ['December', 'January', 'February', 'March'],
		peach: ['June', 'July', 'August'],
		apricot: ['May', 'June', 'July'],
		persimmon: ['October', 'November', 'December'],
		pomegranate: ['September', 'October', 'November'],
	}

	const months = harvestMonths[fruitType.type as keyof typeof harvestMonths] || [
		'Summer',
	]
	const harvestWindow =
		months.length === 1 ? months[0] : `${months[0]}-${months[months.length - 1]}`

	return {
		name: `${faker.person.firstName()}'s ${fruitType.type} tree`,
		type: fruitType.type,
		variety: faker.helpers.arrayElement(fruitType.varieties),
		status: faker.helpers.arrayElement(STATUSES),
		quantity: faker.helpers.arrayElement(QUANTITIES),
		harvestWindow,
		address: faker.location.streetAddress(),
		city: 'Napa',
		state: 'CA',
		zip: faker.helpers.arrayElement(['94558', '94559', '94581', '94574']),
		lat,
		lng,
		h3Index,
		userId,
		notes: faker.helpers.maybe(() => faker.lorem.sentence(), {
			probability: 0.3,
		}),
		accessInstructions: faker.helpers.maybe(
			() =>
				faker.helpers.arrayElement([
					'Ring doorbell',
					'Side gate unlocked',
					'Call when you arrive',
					'Park in driveway',
					'Gate code: 1234',
				]),
			{ probability: 0.5 }
		),
		createdAt: faker.date.past({ years: 1 }),
		updatedAt: faker.date.recent({ days: 30 }),
	}
}

async function seed() {
	console.log('🌱 Seeding database...')

	// Clear listings only — preserve existing auth users
	await db.delete(listings)

	// Insert seed users (skip any that conflict with existing emails)
	const usersData: NewUser[] = Array.from({ length: 20 }, generateUser)
	const inserted = await db
		.insert(user)
		.values(usersData)
		.onConflictDoNothing()
		.returning()

	// Use all users (seed + existing) for listing assignment
	const allUsers = await db.select().from(user)
	console.log(
		`✅ ${allUsers.length} users available (${inserted.length} new, ${allUsers.length - inserted.length} existing)`
	)

	// Generate 50 listings with random users
	const listingsData: NewListing[] = Array.from({ length: 50 }, () => {
		const u = faker.helpers.arrayElement(allUsers)
		return generateListing(u.id)
	})

	// Insert listings
	await db.insert(listings).values(listingsData)

	console.log(`✅ Seeded ${listingsData.length} listings`)

	// Show a few examples
	const examples = await db.select().from(listings).limit(3)
	console.log('\n📋 Sample listings:')
	examples.forEach((listing, i) => {
		console.log(
			`${i + 1}. ${listing.name} - ${listing.type} (${listing.variety}) in ${listing.city}`
		)
	})

	process.exit(0)
}

seed().catch((error) => {
	console.error('❌ Seed failed:', error)
	process.exit(1)
})
