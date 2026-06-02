import {
	createFileRoute,
	Link,
	useNavigate,
	useRouteContext,
} from '@tanstack/solid-router'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { z } from 'zod'
import Layout from '@/components/Layout'
import PageHeader from '@/components/PageHeader'
import Banner from '@/components/Banner'
import InquiryForm from '@/components/InquiryForm'
import ListingMap from '@/components/ListingMap'
import ListingPhotosSection from '@/components/ListingPhotosSection'
import { ListingDetailField } from '@/components/ListingDetailField'
import {
	ADDRESS_RELEASE_OPTIONS,
	addressReleaseSemanticColor,
	getStatusVariant,
	VISIBILITY_OPTIONS,
	statusSemanticColor,
} from '@/lib/listing-status'
import {
	AddressReleasePolicy,
	ListingStatus,
	type AddressReleasePolicyValue,
	type ListingStatusValue,
} from '@/lib/validation'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import { buildListingMeta } from '@/lib/listing-meta'
import { Sentry } from '@/lib/sentry'
import {
	getListingForViewer,
	listingIdParamSchema,
	revealListingAddress,
	updateListing,
} from '@/api/listings'
import type { Listing } from '@/data/schema.server'
import type { PublicListing } from '@/data/queries.server'
import type {
	OwnerListingView,
	PublicPhoto,
	VerifiedPublicListing,
} from '@/data/listing'
import '@/routes/listing-show.css'
import { createErrorSignal, ErrorMessage } from '@/components/ErrorMessage'

const listingSearchSchema = z.object({
	created: z.boolean().optional(),
	marked: z.enum(['unavailable']).optional(),
})

function ListingNotFoundFallback() {
	return (
		<Layout title="Listing Not Found - Pick My Fruit">
			<PageHeader breadcrumbs={[{ label: 'Listing' }]} />
			<main id="main-content" class="listing-show">
				<div class="listing-not-found">
					<h1>Listing Not Found</h1>
					<p>This listing may have been removed or doesn't exist.</p>
					<Link to="/" class="back-link">
						Back to Home
					</Link>
				</div>
			</main>
		</Layout>
	)
}

/**
 * Fallback embed image used when a listing has no cover photo. Matches the
 * `<Apple />` placeholder shown on `ListingCard` so the crawler preview and
 * the in-app card feel visually consistent. Served from `public/`.
 */
const PLACEHOLDER_EMBED = {
	url: '/og-listing-placeholder.png',
	width: '1200',
	height: '630',
	alt: 'Pick My Fruit listing',
}

export const Route = createFileRoute('/listings/$id')({
	validateSearch: listingSearchSchema,
	loader: ({ params }) =>
		getListingForViewer({ data: listingIdParamSchema.parse(params.id) }),
	notFoundComponent: ListingNotFoundFallback,
	head: ({ loaderData }) => {
		// TODO: generate richer embed images for listings. Open Graph / Twitter /
		// Slack crawlers prefer different aspect ratios and resolutions (e.g.
		// 1200x630 landscape for large cards, 1:1 square for summary cards, plus
		// higher-density variants). We should:
		//   - serve multiple renditions per photo (small/large, landscape/square),
		//   - auto-focus the subject (object-fit / smart crop) so fruit stays in
		//     frame across aspect ratios,
		//   - emit og:image:width / og:image:height matching the served rendition.
		// For now we reuse the existing public JPEG URL, which is good enough for
		// most crawlers but ignores the above nuances.
		const coverUrl = coverPhotoUrl(loaderData)
		const textMeta = buildListingMeta(loaderData)
		const imageMeta = coverUrl
			? [
					{ property: 'og:image', content: coverUrl },
					{ name: 'twitter:image', content: coverUrl },
				]
			: [
					{ property: 'og:image', content: PLACEHOLDER_EMBED.url },
					{ property: 'og:image:width', content: PLACEHOLDER_EMBED.width },
					{ property: 'og:image:height', content: PLACEHOLDER_EMBED.height },
					{ property: 'og:image:alt', content: PLACEHOLDER_EMBED.alt },
					{ name: 'twitter:image', content: PLACEHOLDER_EMBED.url },
				]

		if (!textMeta) {
			return { meta: imageMeta }
		}

		return {
			meta: [
				{ title: `${textMeta.title} - Pick My Fruit` },
				{ name: 'description', content: textMeta.description },
				{ property: 'og:title', content: textMeta.title },
				{ property: 'og:description', content: textMeta.description },
				{ name: 'twitter:title', content: textMeta.title },
				{ name: 'twitter:description', content: textMeta.description },
				...imageMeta,
			],
		}
	},
	component: ListingDetailPage,
})

/**
 * Returns the public URL of the listing's cover photo, or undefined if the
 * listing has no photos. Relies on the data-layer invariant that `photos` is
 * sorted by `order` ascending, so `photos[0]` is the cover photo.
 */
function coverPhotoUrl(
	row: Listing | PublicListing | OwnerListingView | undefined
): string | undefined {
	if (!row || !('photos' in row)) {
		return undefined
	}
	return row.photos[0]?.pubUrl
}

const STATUS_DEBOUNCE_MS = 300
const FIELDS_DEBOUNCE_MS = 500

function photosForViewerRow(
	row: Listing | PublicListing | OwnerListingView
): PublicPhoto[] {
	return 'photos' in row ? row.photos : []
}

function OwnerControls(props: {
	listingId: number
	initialStatus: ListingStatusValue
	clientUpdatedAt: () => number
	onUpdated: (updatedAt: Date) => void
}) {
	const [isUpdating, setIsUpdating] = createSignal(false)
	const [savedStatus, setSavedStatus] = createSignal(props.initialStatus)
	const [displayStatus, setDisplayStatus] = createSignal(props.initialStatus)
	const [error, setError] = createErrorSignal()
	let debounceTimer: ReturnType<typeof setTimeout> | undefined

	onCleanup(() => {
		clearTimeout(debounceTimer)
		const pending = displayStatus()
		if (pending !== savedStatus()) void commitStatus(pending)
	})

	function selectStatus(newStatus: ListingStatusValue) {
		if (newStatus === displayStatus()) return
		setDisplayStatus(newStatus)
		setError(null)
		clearTimeout(debounceTimer)
		debounceTimer = setTimeout(() => commitStatus(newStatus), STATUS_DEBOUNCE_MS)
	}

	async function commitStatus(newStatus: ListingStatusValue) {
		if (newStatus === savedStatus()) return
		setIsUpdating(true)
		try {
			const result = await updateListing({
				data: {
					id: props.listingId,
					status: newStatus,
					clientUpdatedAt: props.clientUpdatedAt(),
				},
			})
			setSavedStatus(newStatus)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
			setDisplayStatus(savedStatus())
		} finally {
			setIsUpdating(false)
		}
	}

	return (
		<fieldset class="visibility-fieldset" aria-busy={isUpdating()}>
			{/* Always render the legend — sr-only keeps it off-screen while the
			    grid label cell provides the visible "Visibility" label above. */}
			<legend class="sr-only">Visibility</legend>
			<For each={VISIBILITY_OPTIONS}>
				{(option) => (
					<label
						class="visibility-option"
						classList={{
							'visibility-option--selected': displayStatus() === option.value,
						}}
						style={{ '--visibility-color': statusSemanticColor[option.value] }}
					>
						<input
							type="radio"
							name="visibility"
							value={option.value}
							checked={displayStatus() === option.value}
							onChange={() => selectStatus(option.value)}
						/>
						<span class="visibility-option-text">
							<span class="visibility-option-label">{option.label}</span>
							<span class="visibility-option-description">{option.description}</span>
						</span>
					</label>
				)}
			</For>
			<ErrorMessage
				class="visibility-error"
				defaultMessage="Failed to update"
				error={error()}
			/>
		</fieldset>
	)
}

function AddressVisibilityControls(props: {
	listingId: number
	initialPolicy: AddressReleasePolicyValue
	clientUpdatedAt: () => number
	onUpdated: (updatedAt: Date) => void
	onPolicyChanged: (policy: AddressReleasePolicyValue) => void
}) {
	const [isUpdating, setIsUpdating] = createSignal(false)
	const [savedPolicy, setSavedPolicy] = createSignal(props.initialPolicy)
	const [displayPolicy, setDisplayPolicy] = createSignal(props.initialPolicy)
	const [error, setError] = createErrorSignal()
	let debounceTimer: ReturnType<typeof setTimeout> | undefined

	onCleanup(() => {
		clearTimeout(debounceTimer)
		const pending = displayPolicy()
		if (pending !== savedPolicy()) void commit(pending)
	})

	function select(newPolicy: AddressReleasePolicyValue) {
		if (newPolicy === displayPolicy()) return
		setDisplayPolicy(newPolicy)
		props.onPolicyChanged(newPolicy)
		setError(null)
		clearTimeout(debounceTimer)
		debounceTimer = setTimeout(() => commit(newPolicy), STATUS_DEBOUNCE_MS)
	}

	async function commit(newPolicy: AddressReleasePolicyValue) {
		if (newPolicy === savedPolicy()) return
		setIsUpdating(true)
		try {
			const result = await updateListing({
				data: {
					id: props.listingId,
					addressReleasePolicy: newPolicy,
					clientUpdatedAt: props.clientUpdatedAt(),
				},
			})
			setSavedPolicy(newPolicy)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setError(err)
			setDisplayPolicy(savedPolicy())
			props.onPolicyChanged(savedPolicy())
		} finally {
			setIsUpdating(false)
		}
	}

	return (
		<fieldset class="visibility-fieldset" aria-busy={isUpdating()}>
			<legend class="sr-only">Address Visibility</legend>
			<For each={ADDRESS_RELEASE_OPTIONS}>
				{(option) => (
					<label
						class="visibility-option"
						classList={{
							'visibility-option--selected': displayPolicy() === option.value,
						}}
						style={{
							'--visibility-color': addressReleaseSemanticColor[option.value],
						}}
					>
						<input
							type="radio"
							name="addressReleasePolicy"
							value={option.value}
							checked={displayPolicy() === option.value}
							onChange={() => select(option.value)}
						/>
						<span class="visibility-option-text">
							<span class="visibility-option-label">{option.label}</span>
							<span class="visibility-option-description">{option.description}</span>
						</span>
					</label>
				)}
			</For>
			<ErrorMessage
				class="visibility-error"
				defaultMessage="Failed to update"
				error={error()}
			/>
		</fieldset>
	)
}

function OwnerTitleField(props: {
	listing: OwnerListingView
	clientUpdatedAt: () => number
	onNameSaved: (name: string) => void
	onUpdated: (updatedAt: Date) => void
}) {
	const [savedName, setSavedName] = createSignal(props.listing.name)
	const [displayName, setDisplayName] = createSignal(props.listing.name)
	const [isSaving, setIsSaving] = createSignal(false)
	const [nameError, setNameError] = createErrorSignal()
	let nameTimer: ReturnType<typeof setTimeout> | undefined

	onCleanup(() => {
		clearTimeout(nameTimer)
		const trimmed = displayName().trim()
		if (trimmed && trimmed !== savedName())
			void saveName(trimmed, props.clientUpdatedAt())
	})

	async function saveName(value: string, cat: number) {
		const trimmed = value.trim()
		if (!trimmed) {
			setNameError(new Error('Title cannot be empty'))
			setDisplayName(savedName())
			return
		}
		if (trimmed === savedName()) return
		setIsSaving(true)
		try {
			const result = await updateListing({
				data: { id: props.listing.id, name: trimmed, clientUpdatedAt: cat },
			})
			setSavedName(trimmed)
			setDisplayName(trimmed)
			props.onNameSaved(trimmed)
			setNameError(null)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setNameError(err)
			setDisplayName(savedName())
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<ListingDetailField label="Title" id="listing-title">
			<input
				id="listing-title"
				class="listing-detail-field__input listing-detail-field__input--title"
				type="text"
				value={displayName()}
				aria-busy={isSaving()}
				onInput={(e) => {
					const value = e.currentTarget.value
					setDisplayName(value)
					clearTimeout(nameTimer)
					nameTimer = setTimeout(
						() => saveName(value, props.clientUpdatedAt()),
						FIELDS_DEBOUNCE_MS
					)
				}}
				onBlur={(e) => {
					clearTimeout(nameTimer)
					saveName(e.currentTarget.value, props.clientUpdatedAt())
				}}
				maxlength={200}
				aria-describedby={nameError() ? 'listing-title-error' : undefined}
			/>
			<Show when={nameError()}>
				<ErrorMessage
					id="listing-title-error"
					defaultMessage="Failed to save title"
					error={nameError()}
				/>
			</Show>
		</ListingDetailField>
	)
}

function OwnerEditableFields(props: {
	listing: OwnerListingView
	clientUpdatedAt: () => number
	onUpdated: (updatedAt: Date) => void
	onAddressReleasePolicyChanged: (policy: AddressReleasePolicyValue) => void
}) {
	const [savedHarvest, setSavedHarvest] = createSignal(
		props.listing.harvestWindow ?? ''
	)
	const [displayHarvest, setDisplayHarvest] = createSignal(
		props.listing.harvestWindow ?? ''
	)
	const [harvestSaving, setHarvestSaving] = createSignal(false)
	const [harvestError, setHarvestError] = createErrorSignal()

	const [savedVariety, setSavedVariety] = createSignal<string | null>(
		props.listing.variety ?? null
	)
	const [displayVariety, setDisplayVariety] = createSignal(
		props.listing.variety ?? ''
	)
	const [varietySaving, setVarietySaving] = createSignal(false)
	const [varietyError, setVarietyError] = createErrorSignal()

	const [savedQuantity, setSavedQuantity] = createSignal<string | null>(
		props.listing.quantity ?? null
	)
	const [displayQuantity, setDisplayQuantity] = createSignal(
		props.listing.quantity ?? ''
	)
	const [quantitySaving, setQuantitySaving] = createSignal(false)
	const [quantityError, setQuantityError] = createErrorSignal()

	const [savedNotes, setSavedNotes] = createSignal(props.listing.notes ?? '')
	const [displayNotes, setDisplayNotes] = createSignal(props.listing.notes ?? '')
	const [notesSaving, setNotesSaving] = createSignal(false)
	const [notesError, setNotesError] = createErrorSignal()

	let harvestTimer: ReturnType<typeof setTimeout> | undefined
	let varietyTimer: ReturnType<typeof setTimeout> | undefined
	let quantityTimer: ReturnType<typeof setTimeout> | undefined
	let notesTimer: ReturnType<typeof setTimeout> | undefined

	onCleanup(() => {
		clearTimeout(harvestTimer)
		clearTimeout(varietyTimer)
		clearTimeout(quantityTimer)
		clearTimeout(notesTimer)
		const cat = props.clientUpdatedAt()
		const harvestTrimmed = displayHarvest().trim()
		if (harvestTrimmed && harvestTrimmed !== savedHarvest())
			void saveHarvest(harvestTrimmed, cat)
		const varietyTrimmed = displayVariety().trim()
		const varietyVal = varietyTrimmed || null
		if (varietyVal !== savedVariety()) void saveVariety(varietyTrimmed, cat)
		const quantityTrimmed = displayQuantity().trim()
		const quantityVal = quantityTrimmed || null
		if (quantityVal !== savedQuantity()) void saveQuantity(quantityTrimmed, cat)
		const notesTrimmed = displayNotes().trim()
		if (notesTrimmed !== savedNotes()) void saveNotes(notesTrimmed, cat)
	})

	async function saveHarvest(value: string, cat: number) {
		const trimmed = value.trim()
		if (!trimmed) {
			setHarvestError(new Error('Harvest window cannot be empty'))
			setDisplayHarvest(savedHarvest())
			return
		}
		if (trimmed === savedHarvest()) return
		setHarvestSaving(true)
		try {
			const result = await updateListing({
				data: {
					id: props.listing.id,
					harvestWindow: trimmed,
					clientUpdatedAt: cat,
				},
			})
			setSavedHarvest(trimmed)
			setHarvestError(null)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setHarvestError(err)
			setDisplayHarvest(savedHarvest())
		} finally {
			setHarvestSaving(false)
		}
	}

	async function saveVariety(value: string, cat: number) {
		const trimmed = value.trim()
		const varietyValue = trimmed || null
		if (varietyValue === savedVariety()) return
		setVarietySaving(true)
		try {
			const result = await updateListing({
				data: { id: props.listing.id, variety: varietyValue, clientUpdatedAt: cat },
			})
			setSavedVariety(varietyValue)
			setVarietyError(null)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setVarietyError(err)
			setDisplayVariety(savedVariety() ?? '')
		} finally {
			setVarietySaving(false)
		}
	}

	async function saveQuantity(value: string, cat: number) {
		const trimmed = value.trim()
		const quantityValue = trimmed || null
		if (quantityValue === savedQuantity()) return
		setQuantitySaving(true)
		try {
			const result = await updateListing({
				data: {
					id: props.listing.id,
					quantity: quantityValue,
					clientUpdatedAt: cat,
				},
			})
			setSavedQuantity(quantityValue)
			setQuantityError(null)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setQuantityError(err)
			setDisplayQuantity(savedQuantity() ?? '')
		} finally {
			setQuantitySaving(false)
		}
	}

	async function saveNotes(value: string, cat: number) {
		const trimmed = value.trim()
		const notesValue = trimmed || null
		if (notesValue === (savedNotes() || null)) return
		setNotesSaving(true)
		try {
			const result = await updateListing({
				data: { id: props.listing.id, notes: notesValue, clientUpdatedAt: cat },
			})
			setSavedNotes(trimmed)
			setNotesError(null)
			props.onUpdated(result.updatedAt!)
		} catch (err) {
			Sentry.captureException(err)
			setNotesError(err)
			setDisplayNotes(savedNotes())
		} finally {
			setNotesSaving(false)
		}
	}

	return (
		<>
			<ListingDetailField label="Harvest Window" id="listing-harvest-window">
				<input
					id="listing-harvest-window"
					class="listing-detail-field__input"
					type="text"
					value={displayHarvest()}
					aria-busy={harvestSaving()}
					onInput={(e) => {
						const value = e.currentTarget.value
						setDisplayHarvest(value)
						clearTimeout(harvestTimer)
						harvestTimer = setTimeout(
							() => saveHarvest(value, props.clientUpdatedAt()),
							FIELDS_DEBOUNCE_MS
						)
					}}
					onBlur={(e) => {
						clearTimeout(harvestTimer)
						saveHarvest(e.currentTarget.value, props.clientUpdatedAt())
					}}
					maxlength={50}
					aria-describedby={harvestError() ? 'listing-harvest-error' : undefined}
				/>
				<Show when={harvestError()}>
					<ErrorMessage
						id="listing-harvest-error"
						defaultMessage="Failed to save harvest window"
						error={harvestError()}
					/>
				</Show>
			</ListingDetailField>

			<ListingDetailField label="Variety" id="listing-variety">
				<input
					id="listing-variety"
					class="listing-detail-field__input"
					type="text"
					value={displayVariety()}
					aria-busy={varietySaving()}
					onInput={(e) => {
						const value = e.currentTarget.value
						setDisplayVariety(value)
						clearTimeout(varietyTimer)
						varietyTimer = setTimeout(
							() => saveVariety(value, props.clientUpdatedAt()),
							FIELDS_DEBOUNCE_MS
						)
					}}
					onBlur={(e) => {
						clearTimeout(varietyTimer)
						saveVariety(e.currentTarget.value, props.clientUpdatedAt())
					}}
					maxlength={200}
					placeholder="e.g. Granny Smith"
					aria-describedby={varietyError() ? 'listing-variety-error' : undefined}
				/>
				<Show when={varietyError()}>
					<ErrorMessage
						id="listing-variety-error"
						defaultMessage="Failed to save variety"
						error={varietyError()}
					/>
				</Show>
			</ListingDetailField>

			<ListingDetailField label="Quantity" id="listing-quantity">
				<input
					id="listing-quantity"
					class="listing-detail-field__input"
					type="text"
					value={displayQuantity()}
					aria-busy={quantitySaving()}
					onInput={(e) => {
						const value = e.currentTarget.value
						setDisplayQuantity(value)
						clearTimeout(quantityTimer)
						quantityTimer = setTimeout(
							() => saveQuantity(value, props.clientUpdatedAt()),
							FIELDS_DEBOUNCE_MS
						)
					}}
					onBlur={(e) => {
						clearTimeout(quantityTimer)
						saveQuantity(e.currentTarget.value, props.clientUpdatedAt())
					}}
					maxlength={100}
					placeholder="e.g. abundant, moderate, a few"
					aria-describedby={quantityError() ? 'listing-quantity-error' : undefined}
				/>
				<Show when={quantityError()}>
					<ErrorMessage
						id="listing-quantity-error"
						defaultMessage="Failed to save quantity"
						error={quantityError()}
					/>
				</Show>
			</ListingDetailField>

			{/* TODO: changing location requires re-geocoding the address; leave as
			    read-only until we build that flow. */}
			<ListingDetailField label="Location">
				<span>
					{props.listing.city}, {props.listing.state}
				</span>
			</ListingDetailField>

			<div class="listing-detail-field listing-detail-field--visibility">
				<span class="listing-detail-field__label">Address Visibility</span>
				<div class="listing-detail-field__value">
					<AddressVisibilityControls
						listingId={props.listing.id}
						initialPolicy={props.listing.addressReleasePolicy}
						clientUpdatedAt={props.clientUpdatedAt}
						onUpdated={props.onUpdated}
						onPolicyChanged={props.onAddressReleasePolicyChanged}
					/>
				</div>
			</div>

			<ListingDetailField label="Notes" id="listing-notes">
				<textarea
					id="listing-notes"
					class="listing-detail-field__input"
					value={displayNotes()}
					aria-busy={notesSaving()}
					onInput={(e) => {
						const value = e.currentTarget.value
						setDisplayNotes(value)
						clearTimeout(notesTimer)
						notesTimer = setTimeout(
							() => saveNotes(value, props.clientUpdatedAt()),
							FIELDS_DEBOUNCE_MS
						)
					}}
					onBlur={(e) => {
						clearTimeout(notesTimer)
						saveNotes(e.currentTarget.value, props.clientUpdatedAt())
					}}
					maxlength={1000}
					aria-describedby={notesError() ? 'listing-notes-error' : undefined}
				/>
				<Show when={notesError()}>
					<ErrorMessage
						id="listing-notes-error"
						defaultMessage="Failed to save notes"
						error={notesError()}
					/>
				</Show>
			</ListingDetailField>
		</>
	)
}

type RevealState =
	| { tag: 'hidden' }
	| { tag: 'loading' }
	| { tag: 'gated'; reason: 'email_unverified' }
	| { tag: 'revealed'; listing: VerifiedPublicListing }
	| { tag: 'error'; message: string }

function AddressRevealSection(props: {
	listing: PublicListing
	isAuthenticated: boolean
	loginHref: string
	onRevealed: (listing: VerifiedPublicListing) => void
}) {
	const [state, setState] = createSignal<RevealState>({ tag: 'hidden' })
	const navigate = useNavigate()

	async function reveal() {
		setState({ tag: 'loading' })
		try {
			const result = await revealListingAddress({ data: props.listing.id })
			if (result.tag === 'revealed') {
				setState({ tag: 'revealed', listing: result.listing })
				props.onRevealed(result.listing)
			} else if (result.reason === 'email_unverified') {
				setState({ tag: 'gated', reason: 'email_unverified' })
			} else {
				// Session expired between page load and click — send them to /login
				// rather than showing a "please sign in" interstitial.
				navigate({ to: props.loginHref })
			}
		} catch (err) {
			Sentry.captureException(err)
			setState({
				tag: 'error',
				message: err instanceof Error ? err.message : 'Could not reveal address.',
			})
		}
	}

	return (
		<div class="address-reveal" data-testid="address-reveal">
			<Show when={state().tag === 'hidden'}>
				<p class="address-reveal__intro">
					This owner shares their address with verified members automatically.
				</p>
				<Show
					when={props.isAuthenticated}
					fallback={
						<a class="button button--primary" href={props.loginHref}>
							Sign in to reveal
						</a>
					}
				>
					<button
						type="button"
						class="button button--primary"
						onClick={() => void reveal()}
					>
						Show street address
					</button>
				</Show>
			</Show>
			<Show when={state().tag === 'loading'}>
				<p>Revealing address…</p>
			</Show>
			<Show
				when={
					state().tag === 'gated' &&
					(state() as { tag: 'gated'; reason: string }).reason === 'email_unverified'
				}
			>
				<p class="address-reveal__gate">
					Verify your email address to see this address.
				</p>
			</Show>
			<Show
				when={
					state().tag === 'revealed'
						? (state() as { tag: 'revealed'; listing: VerifiedPublicListing }).listing
						: undefined
				}
			>
				{(revealed) => (
					<address class="address-reveal__address" data-testid="revealed-address">
						<div>{revealed().address}</div>
						<div>
							{revealed().city}, {revealed().state}{' '}
							<Show when={revealed().zip}>{revealed().zip}</Show>
						</div>
					</address>
				)}
			</Show>
			<Show
				when={
					state().tag === 'error'
						? (state() as { tag: 'error'; message: string }).message
						: undefined
				}
			>
				{(message) => <p class="address-reveal__error">{message()}</p>}
			</Show>
		</div>
	)
}

function ListingDetailPage() {
	const data = Route.useLoaderData()
	const context = useRouteContext({ from: '__root__' })
	const params = Route.useParams()
	const search = Route.useSearch()

	const listing = () =>
		data() as Listing | PublicListing | OwnerListingView | undefined
	// OwnerListingView includes userId; PublicListing does not.
	const isOwner = () => {
		const l = listing()
		return !!l && 'userId' in l && context().session?.user?.id === l.userId
	}
	const justCreated = () => search().created === true
	const justMarkedUnavailable = () => search().marked === 'unavailable'
	// Inquiry form is for the owner-approval path. When the listing's policy is
	// `on_verified_request` the address is auto-released, so no inquiry is needed.
	const canInquire = () => {
		const l = listing()
		return (
			l &&
			l.status === ListingStatus.available &&
			!isOwner() &&
			l.addressReleasePolicy !== AddressReleasePolicy.onVerifiedRequest
		)
	}

	// Captures the verified-shape listing once the viewer reveals the address,
	// so the map can swap from a fuzzed hexagon to an exact pin.
	const [revealedListing, setRevealedListing] =
		createSignal<VerifiedPublicListing | null>(null)

	// Used by the unauthenticated reveal CTA to deep-link to /login and bounce
	// the viewer right back to this listing once they're signed in.
	const loginHref = () =>
		`/login?returnTo=${encodeURIComponent(`/listings/${params().id}`)}`

	// Tracks owner's live edits to the title for document title and breadcrumbs.
	const [editableTitle, setEditableTitle] = createSignal<string | null>(null)
	const displayTitle = () => editableTitle() ?? listing()?.name ?? ''

	// Tracks the server-side updatedAt for optimistic concurrency control.
	// Initialized from loader data; updated after each successful save so
	// concurrent edits to different fields don't spuriously conflict.
	const ownerListing = () => {
		const l = listing()
		return l && 'userId' in l ? (l as OwnerListingView) : undefined
	}
	const [liveUpdatedAt, setLiveUpdatedAt] = createSignal<Date | null>(
		ownerListing()?.updatedAt ?? null
	)
	const clientUpdatedAt = () =>
		Math.floor((liveUpdatedAt()?.getTime() ?? 0) / 1000)

	// Tracks owner's live edits to the release policy so the public-hex
	// preview on the owner map can shrink without waiting for a save.
	const [liveAddressReleasePolicy, setLiveAddressReleasePolicy] =
		createSignal<AddressReleasePolicyValue>(
			ownerListing()?.addressReleasePolicy ?? AddressReleasePolicy.onOwnerApproval
		)
	const ownerPublicHexResolution = () =>
		liveAddressReleasePolicy() === AddressReleasePolicy.onVerifiedRequest
			? 12
			: H3_RESOLUTIONS.PUBLIC_DETAIL

	return (
		<Show when={listing()} fallback={<ListingNotFoundFallback />}>
			{(l) => (
				<Layout title={`${displayTitle()} - Pick My Fruit`}>
					<PageHeader breadcrumbs={[{ label: displayTitle() }]} />
					<main id="main-content" class="listing-show">
						<Show when={justCreated() && isOwner()}>
							<Banner variant="success" dismissible>
								Your fruit is listed! Share it with your neighbors.
							</Banner>
						</Show>
						<Show when={justMarkedUnavailable() && isOwner()}>
							<Banner variant="success" dismissible>
								Listing marked as unavailable. Gleaners won't be able to contact you
								about this listing.
							</Banner>
						</Show>
						<article class="listing-detail">
							{/* Public view: h1 + status badge in a flex header row */}
							<Show when={!isOwner()}>
								<header class="listing-detail-header">
									<h1>{displayTitle()}</h1>
									<span class={`badge badge--${getStatusVariant(l().status)}`}>
										{l().status}
									</span>
								</header>
							</Show>

							{/* Owner view: single two-column grid — Title, Photos, divider, then all fields */}
							<Show when={'userId' in l() ? (l() as OwnerListingView) : undefined}>
								{(ownerListing) => (
									<div class="listing-info">
										<OwnerTitleField
											listing={ownerListing()}
											clientUpdatedAt={clientUpdatedAt}
											onNameSaved={setEditableTitle}
											onUpdated={setLiveUpdatedAt}
										/>
										<div class="listing-detail-field listing-detail-field--photos">
											<span class="listing-detail-field__label">Photos</span>
											<div class="listing-detail-field__value">
												<ListingPhotosSection
													isOwner={true}
													listingId={l().id}
													photos={photosForViewerRow(l())}
												/>
											</div>
										</div>
										<div class="listing-detail-divider" role="presentation" />
										<div class="listing-detail-field listing-detail-field--visibility">
											<span
												class="listing-detail-field__label"
												id="listing-visibility-label"
											>
												Visibility
											</span>
											<div class="listing-detail-field__value">
												<OwnerControls
													listingId={l().id}
													initialStatus={l().status as ListingStatusValue}
													clientUpdatedAt={clientUpdatedAt}
													onUpdated={setLiveUpdatedAt}
												/>
											</div>
										</div>
										<OwnerEditableFields
											listing={ownerListing()}
											clientUpdatedAt={clientUpdatedAt}
											onUpdated={setLiveUpdatedAt}
											onAddressReleasePolicyChanged={setLiveAddressReleasePolicy}
										/>
									</div>
								)}
							</Show>

							{/* Public view: photos outside the grid, then a read-only info grid */}
							<Show when={!isOwner()}>
								<ListingPhotosSection
									isOwner={false}
									listingId={l().id}
									photos={photosForViewerRow(l())}
								/>
								<div class="listing-detail-divider" role="presentation" />
								<div class="listing-info">
									<Show when={l().harvestWindow}>
										<ListingDetailField label="Harvest Window">
											<span>{l().harvestWindow}</span>
										</ListingDetailField>
									</Show>

									<Show when={l().variety}>
										<ListingDetailField label="Variety">
											<span>{l().variety}</span>
										</ListingDetailField>
									</Show>

									<Show when={l().quantity}>
										<ListingDetailField label="Quantity">
											<span>{l().quantity}</span>
										</ListingDetailField>
									</Show>

									<ListingDetailField label="Location">
										<span>
											{l().city}, {l().state}
										</span>
									</ListingDetailField>

									<Show
										when={
											'approximateH3Index' in l() &&
											l().addressReleasePolicy === 'on_verified_request'
												? (l() as PublicListing)
												: undefined
										}
									>
										{(pub) => (
											<ListingDetailField label="Address">
												<AddressRevealSection
													listing={pub()}
													isAuthenticated={Boolean(context().session?.user)}
													loginHref={loginHref()}
													onRevealed={setRevealedListing}
												/>
											</ListingDetailField>
										)}
									</Show>

									<Show when={l().notes}>
										<ListingDetailField label="Notes">
											<span>{l().notes}</span>
										</ListingDetailField>
									</Show>
								</div>
							</Show>

							<div class="listing-map-section">
								<Show
									when={isOwner() && 'lat' in l() ? (l() as Listing) : undefined}
									fallback={
										<Show
											when={revealedListing()}
											fallback={
												<Show
													when={
														'approximateH3Index' in l() ? (l() as PublicListing) : undefined
													}
												>
													{(pub) => (
														<ListingMap
															mode="public"
															approximateH3Index={pub().approximateH3Index}
														/>
													)}
												</Show>
											}
										>
											{(revealed) => (
												<ListingMap
													mode="verified"
													lat={revealed().lat}
													lng={revealed().lng}
												/>
											)}
										</Show>
									}
								>
									{(owner) => (
										<Show when={ownerPublicHexResolution()} keyed>
											{(resolution) => (
												<ListingMap
													mode="owner"
													lat={owner().lat}
													lng={owner().lng}
													h3Index={owner().h3Index}
													publicHexResolution={resolution}
												/>
											)}
										</Show>
									)}
								</Show>
							</div>

							<Show when={l().status === ListingStatus.unavailable}>
								<div class="listing-unavailable">
									<h3>This listing is currently unavailable</h3>
									<p>Check back later or browse other available listings.</p>
									<Link to="/" class="back-link">
										Browse Available Listings
									</Link>
								</div>
							</Show>

							<Show when={isOwner()}>
								<div class="listing-owner-notice">
									<p>This is your listing.</p>
									<Link to="/listings/mine" class="back-link">
										Manage My Listings
									</Link>
								</div>
							</Show>

							<Show when={canInquire()}>
								<InquiryForm
									listingId={l().id}
									listingType={l().type}
									callbackURL={`/listings/${params().id}`}
								/>
							</Show>
						</article>
					</main>
				</Layout>
			)}
		</Show>
	)
}
