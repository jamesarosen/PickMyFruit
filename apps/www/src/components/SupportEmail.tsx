import { type JSX } from 'solid-js'
import './SupportEmail.css'

/**
 * Renders the support email with some obfuscation
 * @see https://spencermortensen.com/articles/email-obfuscation/
 * @see https://stackoverflow.com/questions/18749591/encode-html-entities-in-javascript
 */
export function SupportEmail(
	props: JSX.HTMLAttributes<HTMLSpanElement>
): JSX.Element {
	return (
		<kbd {...props} class={`m29cxk1Fm9W ${props.class}`}>
			<span>&#104;&#101;&#108;&#112;</span>&#106;<span>&#97;</span>
			&#109;&#101;&#115;&#64;&#112;&#105;&#99;&#107;
			<span>&#109;&#121;&#102;</span>&#114;&#117;&#105;&#116;&#46;
			<span>&#99;&#111;</span>
			<span>&#99;&#111;&#109;</span>
		</kbd>
	)
}
