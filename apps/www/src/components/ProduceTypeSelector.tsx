import {
	createMemo,
	createSignal,
	createUniqueId,
	onCleanup,
	onMount,
	Show,
} from 'solid-js'
import { Combobox } from '@kobalte/core/combobox'
import { produceTypes, type ProduceType } from '@/lib/produce-types'
import { capitalize } from '@/lib/capitalize'
import '@/components/Combobox.css'

interface Category {
	label: string
	options: ProduceType[]
}

interface ProduceTypeSelectorProps {
	name?: string
	/** Controlled: current slug value. */
	value?: string
	/** Called with the selected slug, or empty string when the field is cleared. */
	onChange?: (slug: string) => void
	/** Error message to display below the field. */
	errorMessage?: string
}

function buildCategories(types: readonly ProduceType[]): Category[] {
	const map = new Map<string, ProduceType[]>()
	for (const t of types) {
		const group = map.get(t.category) ?? []
		group.push(t)
		map.set(t.category, group)
	}
	return Array.from(map.entries()).map(([label, options]) => ({
		label: capitalize(label),
		options,
	}))
}

/** Produce types grouped by category; category order reflects CSV file order. */
const allCategories: readonly Category[] = buildCategories(produceTypes)

/** A searchable form field for selecting a produce type. */
export default function ProduceTypeSelector(props: ProduceTypeSelectorProps) {
	const inputId = createUniqueId()
	const [searchQuery, setSearchQuery] = createSignal('')

	const selectedItem = createMemo(
		() => produceTypes.find((t) => t.slug === props.value) ?? null
	)

	const hasResults = createMemo(() => {
		const q = searchQuery().toLowerCase()
		if (!q) return true
		return produceTypes.some((t) =>
			t.nameSingularTitleCase.toLowerCase().includes(q)
		)
	})

	function handleChange(item: ProduceType | null) {
		setSearchQuery('')
		props.onChange?.(item?.slug ?? '')
	}

	/**
	 * If `props.required`, <HiddenSelect> renders an `<input required>`, but it
	 * doesn't update its value.
	 * @see https://github.com/kobaltedev/kobalte/pull/538
	 */
	const syncHiddenInputOnChange = (e: HTMLElementEventMap['change']) => {
		const select = e.currentTarget as HTMLSelectElement | undefined
		if (!select) return
		const input = select.parentElement?.querySelector('input')
		if (!input) return
		input.value = select.value
	}
	let hiddenSelect: HTMLSelectElement | undefined
	onMount(() => {
		hiddenSelect?.addEventListener('change', syncHiddenInputOnChange)
		onCleanup(() => {
			hiddenSelect?.removeEventListener('change', syncHiddenInputOnChange)
		})
	})

	return (
		<div class="form-field">
			<label class="form-field__label" for={inputId}>
				Produce Type&nbsp;<span class="form-field__required">*</span>
			</label>
			<Combobox<ProduceType, Category>
				/* See https://github.com/orgs/kobaltedev/discussions/648 */
				options={allCategories as Category[]}
				optionValue="slug"
				optionTextValue="nameSingularTitleCase"
				optionLabel="nameSingularTitleCase"
				optionGroupChildren="options"
				value={selectedItem()}
				onChange={handleChange}
				allowsEmptyCollection
				defaultFilter="contains"
				required
				validationState={props.errorMessage ? 'invalid' : 'valid'}
				placeholder="Search produce types…"
				gutter={6}
				overflowPadding={12}
				fitViewport
				itemComponent={(itemProps) => (
					<Combobox.Item item={itemProps.item} class="combobox__item">
						<Combobox.ItemLabel>
							{itemProps.item.rawValue.nameSingularTitleCase}
						</Combobox.ItemLabel>
						<Combobox.ItemIndicator class="combobox__item-check">
							✓
						</Combobox.ItemIndicator>
					</Combobox.Item>
				)}
				sectionComponent={(sectionProps) => (
					<Combobox.Section class="combobox__section">
						{sectionProps.section.rawValue.label}
					</Combobox.Section>
				)}
			>
				<Combobox.HiddenSelect name={props.name} ref={hiddenSelect} />
				<Combobox.Control class="combobox__control focus-ring">
					<Combobox.Input
						id={inputId}
						class="combobox__input focus-ring-none"
						onInput={(e) => setSearchQuery(e.currentTarget.value)}
					/>
					<Combobox.Trigger
						class="combobox__trigger"
						aria-label="Open produce type list"
					>
						<Combobox.Icon class="combobox__icon">▾</Combobox.Icon>
					</Combobox.Trigger>
				</Combobox.Control>
				<Combobox.Portal>
					<Combobox.Content class="combobox__content">
						<Combobox.Listbox class="combobox__listbox" />
						<Show when={!hasResults()}>
							<p class="combobox__no-result">No produce types match your search.</p>
						</Show>
					</Combobox.Content>
				</Combobox.Portal>
			</Combobox>
			<Show when={props.errorMessage}>
				<p class="form-field__error" role="alert">
					{props.errorMessage}
				</p>
			</Show>
		</div>
	)
}
