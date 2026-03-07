import {
	Root,
	Label,
	Description,
	ErrorMessage,
	HiddenSelect,
	Trigger,
	Value,
	Icon,
	Portal,
	Content,
	Listbox,
	Item,
	ItemLabel,
	type SelectRootProps,
} from '@kobalte/core/select'
import {
	children,
	type ComponentProps,
	For,
	type JSX,
	onCleanup,
	onMount,
	Show,
	splitProps,
	type ValidComponent,
} from 'solid-js'
import './FormField.css'
import './Select.css'

/** Re-exported for use in `itemComponent` render props. */
export function SelectItem(props: ComponentProps<typeof Item>) {
	const [local, rest] = splitProps(props, ['class'])
	return (
		<Item
			class={['select-item', local.class].filter(Boolean).join(' ')}
			{...rest}
		/>
	)
}

/** Re-exported for use in `itemComponent` render props. */
export { ItemLabel as SelectItemLabel }

// `itemComponent` is optional in SelectRootProps but required here: without it the
// listbox opens empty. The intersection makes TypeScript enforce it at call sites.
type SelectFieldProps<
	Option,
	OptGroup = never,
	T extends ValidComponent | HTMLElement = HTMLElement,
> = {
	errors?: string[]
	hint?: JSX.Element
	label: JSX.Element
	/**
	 * Required. Use `SelectItem` and `SelectItemLabel` from this module inside
	 * `itemComponent`. Without it the listbox opens but renders no items.
	 */
	itemComponent: NonNullable<
		SelectRootProps<Option, OptGroup, T>['itemComponent']
	>
	placeholder?: string
	/** Renders the selected option in the trigger. Defaults to `String(option)`. */
	renderValue?: (option: Option) => JSX.Element
	required?: boolean
} & SelectRootProps<Option, OptGroup, T>

const FIELD_PROPS = [
	'errors',
	'hint',
	'label',
	'placeholder',
	'renderValue',
	'required',
] as const

/** A select field with label, trigger, dropdown, hint, and error support. */
export function Select<
	Option,
	OptGroup = never,
	T extends ValidComponent | HTMLElement = HTMLElement,
>(props: SelectFieldProps<Option, OptGroup, T>) {
	const [local, rest] = splitProps(props, FIELD_PROPS)

	/**
	 * Solid 1.x complains about hydration mismatch when using an JSX.Element
	 * slot-prop inside a <Show>
	 * We can remove this memo after we upgrade to 2.x
	 * @see https://github.com/solidjs/solid/issues/1977
	 */
	const renderedHint = children(() => local.hint)
	const renderedLabel = children(() => local.label)

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
		<Root
			class="form-field"
			placeholder={local.placeholder}
			required={local.required}
			validationState={(local.errors?.length ?? 0) === 0 ? 'valid' : 'invalid'}
			{...rest}
		>
			{/* Renders a visually-hidden native <select> so the field participates in FormData. */}
			<HiddenSelect ref={hiddenSelect} />

			<Label as="label" class="form-field__label">
				<Show when={renderedLabel()}>{renderedLabel()}</Show>
				<Show when={local.required}>
					&nbsp;
					<span class="form-field__required">*</span>
				</Show>
			</Label>

			<Trigger class="form-field__control form-field__select-trigger">
				<Value<Option>>
					{(state) => {
						const opt = state.selectedOption()
						return local.renderValue
							? local.renderValue(opt)
							: (String(opt) as unknown as JSX.Element)
					}}
				</Value>
				<Icon class="form-field__select-icon">▾</Icon>
			</Trigger>

			<Show when={renderedHint()}>
				<Description class="form-field__hint">{renderedHint()}</Description>
			</Show>

			<Show when={(local.errors?.length ?? 0) > 0}>
				<ErrorMessage class="form-field__errors">
					<For each={local.errors}>
						{(error) => <div class="form-field__error">{error}</div>}
					</For>
				</ErrorMessage>
			</Show>

			<Portal>
				<Content class="select-content">
					<Listbox class="select-listbox" />
				</Content>
			</Portal>
		</Root>
	)
}
