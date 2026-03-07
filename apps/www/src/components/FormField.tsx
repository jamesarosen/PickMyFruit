import {
	Root,
	Label,
	Description,
	ErrorMessage,
	Input as KInput,
	TextArea as KTextArea,
	type TextFieldRootProps,
} from '@kobalte/core/text-field'
import {
	children,
	type ComponentProps,
	For,
	type JSX,
	Show,
	splitProps,
} from 'solid-js'
import './FormField.css'

type TextFieldProps = {
	children: JSX.Element
	errors?: string[]
	hint?: JSX.Element
	label: JSX.Element
	note?: JSX.Element
} & Pick<
	TextFieldRootProps,
	'defaultValue' | 'name' | 'onChange' | 'required' | 'value'
>

const FIELD_PROPS = [
	'children',
	'defaultValue',
	'errors',
	'hint',
	'label',
	'name',
	'note',
	'onChange',
	'required',
	'value',
] as const

// Compile-time guard: every key in FIELD_PROPS must be a key of TextFieldProps.
// If TextFieldProps gains a new prop that isn't added here, the split will leak
// it down to the underlying Kobalte control. Add the new prop to FIELD_PROPS.
const _fieldPropsSync: (typeof FIELD_PROPS)[number] extends keyof TextFieldProps
	? true
	: never = true
void _fieldPropsSync

/** A form field wrapping Kobalte's TextField with a label, hint, note, and errors. */
export function TextField(props: TextFieldProps) {
	/**
	 * Solid 1.x complains about hydration mismatch when using an JSX.Element
	 * slot-prop inside a <Show>
	 * We can remove this memo after we upgrade to 2.x
	 * @see https://github.com/solidjs/solid/issues/1977
	 */
	const renderedHint = children(() => props.hint)
	const renderedLabel = children(() => props.label)

	return (
		<Root
			class="form-field"
			defaultValue={props.defaultValue}
			name={props.name}
			onChange={props.onChange}
			required={props.required}
			validationState={(props.errors?.length ?? 0) === 0 ? 'valid' : 'invalid'}
			value={props.value}
		>
			<Label class="form-field__label">
				<Show when={renderedLabel()}>{renderedLabel()}</Show>
				<Show when={props.required}>
					&nbsp;
					<span class="form-field__required">*</span>
				</Show>
			</Label>

			{props.children}

			<Show when={renderedHint()}>
				<Description class="form-field__hint">{renderedHint()}</Description>
			</Show>

			<Show when={(props.errors?.length ?? 0) > 0}>
				<ErrorMessage class="form-field__errors">
					<For each={props.errors}>
						{(error) => <div class="form-field__error">{error}</div>}
					</For>
				</ErrorMessage>
			</Show>
		</Root>
	)
}

type InputFieldProps = Omit<TextFieldProps, 'children'> &
	ComponentProps<typeof KInput>

/** A single-line text input with label, hint, note, and error support. */
export function Input(props: InputFieldProps) {
	const [fieldProps, rest] = splitProps(props, FIELD_PROPS)
	return (
		<TextField {...fieldProps}>
			<KInput class="form-field__control" {...rest} />
		</TextField>
	)
}

type TextareaFieldProps = Omit<TextFieldProps, 'children'> &
	ComponentProps<typeof KTextArea>

/** A multi-line textarea with label, hint, note, and error support. */
export function Textarea(props: TextareaFieldProps) {
	const [fieldProps, rest] = splitProps(props, FIELD_PROPS)
	return (
		<TextField {...fieldProps}>
			<KTextArea class="form-field__control" {...rest} />
		</TextField>
	)
}
