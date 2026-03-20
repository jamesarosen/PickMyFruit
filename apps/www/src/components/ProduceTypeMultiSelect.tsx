import { createMemo, createSignal, For, Show } from 'solid-js'
import { Combobox } from '@kobalte/core/combobox'
import { produceTypes, type ProduceType } from '@/lib/produce-types'
import { capitalize } from '@/lib/capitalize'
import '@/components/Combobox.css'

interface Category {
	label: string
	options: ProduceType[]
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

const allCategories: readonly Category[] = buildCategories(produceTypes)

interface ProduceTypeMultiSelectProps {
	/** Controlled: selected slugs. Empty array means "all types". */
	value: string[]
	onChange: (slugs: string[]) => void
}

/** A multi-select combobox for produce types. Empty selection means "all types". */
export default function ProduceTypeMultiSelect(
	props: ProduceTypeMultiSelectProps
) {
	const [searchQuery, setSearchQuery] = createSignal('')

	const selectedItems = createMemo(() =>
		props.value
			.map((slug) => produceTypes.find((t) => t.slug === slug))
			.filter((t): t is ProduceType => t !== undefined)
	)

	const hasResults = createMemo(() => {
		const q = searchQuery().toLowerCase()
		if (!q) return true
		return produceTypes.some((t) => t.commonName.toLowerCase().includes(q))
	})

	function handleChange(items: ProduceType[]) {
		setSearchQuery('')
		props.onChange(items.map((t) => t.slug))
	}

	return (
		<div class="form-field">
			<label class="form-field__label">Produce types</label>
			<Combobox<ProduceType, Category>
				multiple
				/* See https://github.com/orgs/kobaltedev/discussions/648 */
				options={allCategories as Category[]}
				optionValue="slug"
				optionTextValue="commonName"
				optionLabel="commonName"
				optionGroupChildren="options"
				value={selectedItems()}
				onChange={handleChange}
				allowsEmptyCollection
				defaultFilter="contains"
				placeholder="All produce types"
				itemComponent={(itemProps) => (
					<Combobox.Item item={itemProps.item} class="combobox__item">
						<Combobox.ItemLabel>
							{itemProps.item.rawValue.commonName}
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
				<Combobox.Control<ProduceType> class="combobox__control combobox__control--multi focus-ring">
					{(state) => (
						<>
							<For each={state.selectedOptions()}>
								{(item) => (
									<span class="combobox__tag">
										{item.commonName}
										<button
											type="button"
											class="combobox__tag-remove"
											onClick={() => state.remove(item)}
											aria-label={`Remove ${item.commonName}`}
										>
											×
										</button>
									</span>
								)}
							</For>
							<Combobox.Input
								class="combobox__input focus-ring-none"
								onInput={(e) => setSearchQuery(e.currentTarget.value)}
							/>
							<Combobox.Trigger
								class="combobox__trigger"
								aria-label="Open produce type list"
							>
								<Combobox.Icon class="combobox__icon">▾</Combobox.Icon>
							</Combobox.Trigger>
						</>
					)}
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
		</div>
	)
}
