import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'
import { db } from './db'
import { plants, type NewPlant } from './schema'

// Napa Valley approximate bounds
const NAPA_BOUNDS = {
	latMin: 38.25,
	latMax: 38.55,
	lngMin: -122.50,
	lngMax: -122.20,
}

const FRUIT_TYPES = [
	{ type: 'apple', varieties: ['Granny Smith', 'Honeycrisp', 'Fuji', 'Gala', 'Red Delicious'] },
	{ type: 'pear', varieties: ['Bartlett', 'Bosc', 'Anjou', 'Asian', 'Comice'] },
	{ type: 'plum', varieties: ['Santa Rosa', 'Black Beauty', 'Satsuma', 'Italian Prune'] },
	{ type: 'fig', varieties: ['Black Mission', 'Brown Turkey', 'Kadota', 'Calimyrna'] },
	{ type: 'lemon', varieties: ['Eureka', 'Lisbon', 'Meyer', 'Variegated Pink'] },
	{ type: 'orange', varieties: ['Navel', 'Valencia', 'Blood Orange', 'Cara Cara'] },
	{ type: 'peach', varieties: ['Elberta', 'Redhaven', 'Georgia Belle', 'Donut'] },
	{ type: 'apricot', varieties: ['Blenheim', 'Tilton', 'Moorpark', 'Royal'] },
	{ type: 'persimmon', varieties: ['Fuyu', 'Hachiya', 'Chocolate', 'Tanenashi'] },
	{ type: 'pomegranate', varieties: ['Wonderful', 'Angel Red', 'Eversweet', 'Kashmir Blend'] },
]

const QUANTITIES = ['abundant', 'moderate', 'few']
const STATUSES = ['available', 'available', 'available', 'claimed'] // More weight to available

function generatePlant(): NewPlant {
	const fruitType = faker.helpers.arrayElement(FRUIT_TYPES)
	const lat = faker.number.float({ min: NAPA_BOUNDS.latMin, max: NAPA_BOUNDS.latMax, fractionDigits: 6 })
	const lng = faker.number.float({ min: NAPA_BOUNDS.lngMin, max: NAPA_BOUNDS.lngMax, fractionDigits: 6 })
	const h3Index = latLngToCell(lat, lng, 9)
	
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
	
	const months = harvestMonths[fruitType.type as keyof typeof harvestMonths] || ['Summer']
	const harvestWindow = months.length === 1 ? months[0] : `${months[0]}-${months[months.length - 1]}`
	
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
		h3Index, // Keep as hex string
		ownerName: faker.person.fullName(),
		ownerEmail: faker.internet.email(),
		ownerPhone: faker.phone.number({ style: 'national' }),
		notes: faker.helpers.maybe(() => faker.lorem.sentence(), { probability: 0.3 }),
		accessInstructions: faker.helpers.maybe(
			() => faker.helpers.arrayElement([
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
	
	// Clear existing data
	await db.delete(plants)
	
	// Generate 50 plants
	const plantsData: NewPlant[] = Array.from({ length: 50 }, generatePlant)
	
	// Insert plants
	await db.insert(plants).values(plantsData)
	
	console.log(`✅ Seeded ${plantsData.length} plants`)
	
	// Show a few examples
	const examples = await db.select().from(plants).limit(3)
	console.log('\n📋 Sample plants:')
	examples.forEach((plant, i) => {
		console.log(`${i + 1}. ${plant.name} - ${plant.type} (${plant.variety}) in ${plant.city}`)
	})
	
	process.exit(0)
}

seed().catch((error) => {
	console.error('❌ Seed failed:', error)
	process.exit(1)
})