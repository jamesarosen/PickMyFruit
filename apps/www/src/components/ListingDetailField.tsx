import { Show, type JSX } from 'solid-js'
import './ListingDetailField.css'

interface ListingDetailFieldProps {
	/** Visible label text. */
	label: string
	/**
	 * When provided, renders a `<label for={id}>` that associates with a form
	 * control. Omit for read-only rows where children is plain text.
	 */
	id?: string
	/** 'stacked' spans both columns — use for multi-line content like Notes. */
	layout?: 'inline' | 'stacked'
	children: JSX.Element
}

/** A label/value row that participates in the parent `.listing-info` grid. */
export function ListingDetailField(props: ListingDetailFieldProps) {
	return (
		<div
			class="listing-detail-field"
			classList={{ 'listing-detail-field--stacked': props.layout === 'stacked' }}
		>
			<Show
				when={props.id}
				fallback={<span class="listing-detail-field__label">{props.label}</span>}
			>
				{(id) => (
					<label class="listing-detail-field__label" for={id()}>
						{props.label}
					</label>
				)}
			</Show>
			<div class="listing-detail-field__value">{props.children}</div>
		</div>
	)
}
