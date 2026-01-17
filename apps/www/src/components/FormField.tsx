import { Show, type JSX } from 'solid-js'

interface FormFieldProps {
	id: string
	label: string
	required?: boolean
	error?: string[]
	children: JSX.Element
	hint?: string
}

export default function FormField(props: FormFieldProps) {
	return (
		<div class="form-group">
			<label for={props.id}>
				{props.label}
				<Show when={props.required}>
					{' '}
					<span class="required">*</span>
				</Show>
			</label>
			{props.children}
			<Show when={props.hint}>
				<div class="hint">{props.hint}</div>
			</Show>
			<Show when={props.error}>
				<div class="form-error">{props.error?.[0]}</div>
			</Show>
		</div>
	)
}

export function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1)
}
