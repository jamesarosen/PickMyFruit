import { clsx } from 'clsx'
import isNetworkError from 'is-network-error'
import { createSignal, JSX, Show, splitProps } from 'solid-js'
import './ErrorMessage.css'

interface ErrorMessageProps extends Omit<
	JSX.HTMLAttributes<HTMLParagraphElement>,
	'role'
> {
	defaultMessage?: string
	error: unknown
}

/**
 * Helper function to create a signal compatible with the `<ErrorMessage>`
 * component.
 */
export function createErrorSignal<T = unknown>(initial?: T) {
	return createSignal<T | null>(initial ?? null)
}

/**
 * Display an error message. Adds some intelligence around making certain types
 * of errors more user-friendly. Only shows anything if `error != null`.
 */
export function ErrorMessage(props: ErrorMessageProps) {
	const [local, rest] = splitProps(props, ['defaultMessage', 'error'])

	const message = () => {
		if (local.error == null) return null
		if (isNetworkError(local.error)) return 'Network error. Retrying may help.'
		if (typeof local.error === 'string') return local.error
		if ((local.error as Error).message) return (local.error as Error).message

		return (
			local.defaultMessage ??
			"Sorry, we're having trouble right now. We've been notified."
		)
	}

	return (
		<Show when={message()}>
			{(msg) => (
				<p {...rest} class={clsx('error-message', rest.class)} role="alert">
					{msg()}
				</p>
			)}
		</Show>
	)
}
