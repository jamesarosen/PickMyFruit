import { createMemo, createUniqueId } from 'solid-js'
import { Combobox } from '@kobalte/core/combobox'
import { produceTypes, type ProduceType } from '@/lib/produce-types'
import { capitalize } from '@/lib/capitalize'
import '@/components/Combobox.css'

interface Category {
	label: string
	options: ProduceType[]
}

interface ProduceTypeSelectorProps {
	/** Controlled: current slug value. */
	value?: string
	/** Called with the selected slug, or empty string when the field is cleared. */
	onChange?: (slug: string) => void
	/** Error message to display below the control. */
	errorMessage?: string
	/** HTML id for the input element, for external `<label for>` association. */
	id?: string
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

/**
 * A searchable combobox for selecting a produce type.
 * Note: ProduceTypeSelector accepts an error message for error styling, but
 * doesn't display it because it assumes that the wrapping FormField will.
 *
 * @todo make the Field-vs-Control distinction and abstraction clearer across
 * all fields.
 */
export default function ProduceTypeSelector(props: ProduceTypeSelectorProps) {
	const inputId = props.id ?? createUniqueId()

	const selectedItem = createMemo(
		() => produceTypes.find((t) => t.slug === props.value) ?? null
	)

	function handleChange(item: ProduceType | null) {
		props.onChange?.(item?.slug ?? '')
	}

	return (
		<Combobox<ProduceType, Category>
			/* See https://github.com/orgs/kobaltedev/discussions/648 */
			options={allCategories as Category[]}
			optionValue="slug"
			optionTextValue="commonName"
			optionLabel="commonName"
			optionGroupChildren="options"
			value={selectedItem()}
			onChange={handleChange}
			defaultFilter="contains"
			validationState={props.errorMessage ? 'invalid' : 'valid'}
			placeholder="Search produce types…"
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
			<Combobox.Control
				class="combobox__control focus-ring"
				aria-label="Produce type"
			>
				<Combobox.Input id={inputId} class="combobox__input focus-ring-none" />
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
				</Combobox.Content>
			</Combobox.Portal>
		</Combobox>
	)
}
