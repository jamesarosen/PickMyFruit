// This file would normally be an API endpoint
// For now, we'll use mock data since we can't run SQLite in the browser
// In production, this would be served from a backend API

import type { Plant } from '@/data/schema'

// Mock data that simulates what would come from the database
export async function getAvailablePlants(limit: number = 3): Promise<Plant[]> {
	// Simulating network delay
	await new Promise((resolve) => setTimeout(resolve, 500))

	const allPlants = [
		{
			id: 1,
			name: "Sarah's apple tree",
			type: 'apple',
			variety: 'Honeycrisp',
			status: 'available',
			quantity: 'abundant',
			harvestWindow: 'September-October',
			address: '123 Oak Street',
			city: 'Napa',
			state: 'CA',
			zip: '94558',
			lat: 38.297,
			lng: -122.286,
			h3Index: '8d283005350e03f',
			ownerName: 'Sarah Johnson',
			ownerEmail: 'sarah@example.com',
			ownerPhone: '707-555-0001',
			notes: 'Beautiful mature tree with sweet apples. Great for pies!',
			accessInstructions: 'Ring doorbell',
			createdAt: new Date('2024-09-01'),
			updatedAt: new Date('2024-09-15'),
		},
		{
			id: 2,
			name: "Mike's lemon tree",
			type: 'lemon',
			variety: 'Meyer',
			status: 'available',
			quantity: 'moderate',
			harvestWindow: 'Year-round',
			address: '456 Vine Avenue',
			city: 'Napa',
			state: 'CA',
			zip: '94559',
			lat: 38.312,
			lng: -122.295,
			h3Index: '8d28300535114bf',
			ownerName: 'Mike Chen',
			ownerEmail: 'mike@example.com',
			ownerPhone: '707-555-0002',
			notes: null,
			accessInstructions: 'Side gate unlocked',
			createdAt: new Date('2024-08-15'),
			updatedAt: new Date('2024-09-20'),
		},
		{
			id: 3,
			name: "Emma's fig tree",
			type: 'fig',
			variety: 'Black Mission',
			status: 'available',
			quantity: 'abundant',
			harvestWindow: 'June-September',
			address: '789 Garden Way',
			city: 'Napa',
			state: 'CA',
			zip: '94558',
			lat: 38.289,
			lng: -122.278,
			h3Index: '8d283005359477f',
			ownerName: 'Emma Rodriguez',
			ownerEmail: 'emma@example.com',
			ownerPhone: '707-555-0003',
			notes: 'Figs are perfect for jam making. Take as many as you need!',
			accessInstructions: 'Call when you arrive',
			createdAt: new Date('2024-07-20'),
			updatedAt: new Date('2024-09-18'),
		},
	]

	return allPlants.slice(0, limit)
}
